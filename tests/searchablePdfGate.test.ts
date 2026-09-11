import { describe, expect, it, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DetectedEntity } from '../src/shared/types'
import type { PdfPageQualityOutcome } from '../src/main/services/ocrLayerCheck'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() }
}))

import { generatePdfSafe } from '../src/main/outputGenerators/pdfSafeGenerator'
import { ocrArtifactCache } from '../src/main/services/ocrArtifactCache'
import { transformRect, type Rect } from '../src/main/services/geometry'

const FIXTURE = join(__dirname, 'corpus-ocr', 'negativi', 'neg-02-allineato-flate.pdf')
const GATE = join(process.cwd(), 'scripts', 'verify-searchable-pdf.mjs')

const ALIGNED_PAGE_SAFETY: PdfPageQualityOutcome[] = [{
  page: 1,
  status: 'scan-aligned',
  layerKind: 'scan-with-text',
  existingTextLayerUsable: true,
  reason: 'ok',
  metrics: {
    coverage: 1, lift: 2, lineAgreement: 1,
    scaleY: 1, offsetXPt: 0, offsetYPt: 0,
  },
  imageMetrics: null,
}]

describe('gate PDF ricercabile v1.7', () => {
  it('richiede Poppler e Tesseract 5 con lingua italiana', () => {
    for (const tool of ['pdftoppm', 'pdftotext', 'pdfdetach']) {
      const probe = spawnSync(tool, ['-v'], { encoding: 'utf8' })
      expect(probe.error, `${tool} non eseguibile`).toBeUndefined()
      expect(`${probe.stdout}${probe.stderr}`).toMatch(/poppler|pdf/i)
    }
    const version = execFileSync('tesseract', ['--version'], { encoding: 'utf8' })
    expect(version).toMatch(/^tesseract 5\./)
    const languages = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' })
    expect(languages.split(/\s+/)).toContain('ita')
  })

  it('un output partial resta raster-only e supera sanitizzazione e confronto visivo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-searchable-gate-'))
    const input = join(dir, 'source.pdf')
    await copyFile(FIXTURE, input)
    const missing: DetectedEntity = {
      id: 'missing-1', type: 'PERSONA', originalText: 'Persona Non Presente',
      pseudonym: 'PERSONA_999', occurrences: 1, confirmed: true
    }
    try {
      const reference = await generatePdfSafe(input, [], {
        routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true,
        pageSafety: ALIGNED_PAGE_SAFETY,
        rasterCodec: 'bitonal-auto',
      })
      const result = await generatePdfSafe(input, [missing], {
        routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true,
        pageSafety: ALIGNED_PAGE_SAFETY,
        rasterCodec: 'bitonal-auto',
      })
      expect(result.safetyStatus).toBe('partial')
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        const page = output.loadPage(0)
        const structured = page.toStructuredText('preserve-images')
        const formats: Array<{ bits: number; colorSpace: string | null }> = []
        try {
          structured.walk({ onImageBlock(_bbox, _matrix, image) {
            formats.push({
              bits: image.getBitsPerComponent(),
              colorSpace: image.getColorSpace()?.getType() ?? null,
            })
          } })
        } finally {
          structured.destroy()
          page.destroy()
        }
        expect(formats).toEqual([{ bits: 1, colorSpace: 'Gray' }])
      } finally {
        output.destroy()
      }
      execFileSync(process.execPath, [GATE,
        '--source', input,
        '--visual-reference', reference.outputPath,
        '--output', result.outputPath,
        '--status', 'partial',
        '--original', missing.originalText
      ], { stdio: 'pipe' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('riusa il box OCR in RAM e produce un PDF completo con il solo pseudonimo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-searchable-complete-'))
    const input = join(dir, 'source.pdf')
    await copyFile(FIXTURE, input)
    const token = 'a'.repeat(64)
    const entity: DetectedEntity = {
      id: 'person-1', type: 'PERSONA', originalText: 'Mario Rossi',
      pseudonym: 'PERSONA_1', occurrences: 1, expectedOccurrences: 1, confirmed: true,
    }
    try {
      const mupdf = (await import('mupdf')).default
      const source = new mupdf.PDFDocument(new Uint8Array(await readFile(input)))
      const page = source.loadPage(0)
      const matrix: import('mupdf').Matrix = [200 / 72, 0, 0, 200 / 72, 0, 0]
      try {
        const quads = page.search(entity.originalText)
        expect(quads).toHaveLength(1)
        const values = quads[0].flat()
        const mupdfBox: Rect = {
          x0: Math.min(...values.filter((_, index) => index % 2 === 0)),
          y0: Math.min(...values.filter((_, index) => index % 2 === 1)),
          x1: Math.max(...values.filter((_, index) => index % 2 === 0)),
          y1: Math.max(...values.filter((_, index) => index % 2 === 1)),
        }
        const handle = ocrArtifactCache.stage({ pages: [{
          page: 1,
          renderMatrix: matrix,
          pixmapOrigin: { x: 0, y: 0 },
          words: [{
            text: entity.originalText,
            bbox: transformRect(mupdfBox, matrix),
            confidence: 99,
            line: 0,
            page: 1,
          }],
        }] })
        ocrArtifactCache.bind(handle, token)
      } finally {
        page.destroy()
        source.destroy()
      }

      const reference = await generatePdfSafe(input, [entity], {
        routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true,
        pageSafety: ALIGNED_PAGE_SAFETY,
        rasterCodec: 'bitonal-auto',
      })
      const result = await generatePdfSafe(input, [entity], {
        routing: 'flattened-scan',
        layerKind: 'scan-no-text',
        pageSafety: [{
          page: 1,
          status: 'scan-untrusted',
          layerKind: 'scan-no-text',
          existingTextLayerUsable: false,
          reason: 'no-text-layer',
          metrics: {
            coverage: null, lift: null, lineAgreement: null,
            scaleY: null, offsetXPt: null, offsetYPt: null,
          },
          imageMetrics: null,
        }],
        analysisToken: token,
        rasterCodec: 'bitonal-auto',
      })
      expect(result.safetyStatus).toBe('complete')
      const bitonalOutput = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        const bitonalPage = bitonalOutput.loadPage(0)
        const structured = bitonalPage.toStructuredText('preserve-images')
        const imageKinds: Array<{ bits: number; colorSpace: string | null }> = []
        try {
          structured.walk({
            onImageBlock(_bbox, _matrix, image) {
              imageKinds.push({
                bits: image.getBitsPerComponent(),
                colorSpace: image.getColorSpace()?.getType() ?? null,
              })
            },
          })
        } finally {
          structured.destroy()
          bitonalPage.destroy()
        }
        expect(imageKinds).toEqual([{ bits: 1, colorSpace: 'Gray' }])
      } finally {
        bitonalOutput.destroy()
      }
      execFileSync(process.execPath, [GATE,
        '--source', input,
        '--visual-reference', reference.outputPath,
        '--output', result.outputPath,
        '--status', 'complete',
        '--original', entity.originalText,
        '--pseudonym', entity.pseudonym,
      ], { stdio: 'pipe' })
    } finally {
      ocrArtifactCache.release(token)
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
