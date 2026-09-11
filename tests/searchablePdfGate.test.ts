import { describe, expect, it, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DetectedEntity } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() }
}))

import { generatePdfSafe } from '../src/main/outputGenerators/pdfSafeGenerator'
import { ocrArtifactCache } from '../src/main/services/ocrArtifactCache'
import { transformRect, type Rect } from '../src/main/services/geometry'

const FIXTURE = join(__dirname, 'corpus-ocr', 'negativi', 'neg-02-allineato-flate.pdf')
const GATE = join(process.cwd(), 'scripts', 'verify-searchable-pdf.mjs')

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
      const result = await generatePdfSafe(input, [missing], {
        routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true
      })
      expect(result.safetyStatus).toBe('partial')
      execFileSync(process.execPath, [GATE,
        '--source', input,
        '--visual-reference', result.outputPath,
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
      })
      expect(result.safetyStatus).toBe('complete')
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
