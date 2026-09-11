import { describe, expect, it, vi } from 'vitest'
import { copyFile, mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { DetectedEntity } from '../src/shared/types'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  MAX_PAGE_PIXELS,
  PdfGenerationError,
  enforcePixelBudget,
  generatePdfSafe,
  weightedMedian,
} from '../src/main/outputGenerators/pdfSafeGenerator'

const CORPUS = join(__dirname, 'corpus-ocr', 'immagine')

function entity(): DetectedEntity {
  return { id: 'person-1', type: 'PERSONA', originalText: 'Mario Rossi', pseudonym: 'PERSONA_1', occurrences: 2, confirmed: true }
}

describe('primitive D1 fail-closed', () => {
  it('calcola la mediana pesata per area', () => {
    expect(weightedMedian([{ value: 200, weight: 10 }, { value: 300, weight: 80 }, { value: 600, weight: 10 }])).toBe(300)
    expect(weightedMedian([])).toBeNull()
  })

  it('rifiuta oltre 50 MP con codice resource-limit', () => {
    expect(() => enforcePixelBudget(10_000, 5_001)).toThrow(PdfGenerationError)
    try { enforcePixelBudget(10_000, 5_001) } catch (error) {
      expect((error as PdfGenerationError).code).toBe('resource-limit')
    }
    expect(() => enforcePixelBudget(10_000, MAX_PAGE_PIXELS / 10_000)).not.toThrow()
  })
})

describe('ricostruzione raster D1', () => {
  it('crea un PDF nuovo, raster-only, conserva le pagine e non sovrascrive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-safe-pdf-'))
    const input = join(dir, 'scan.pdf')
    await copyFile(join(CORPUS, 'img-13-xobject-condiviso.pdf'), input)
    try {
      const first = await generatePdfSafe(input, [entity()], { routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true })
      const second = await generatePdfSafe(input, [entity()], { routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true })
      expect(first.redactionMode).toBe('flattened-scan')
      expect(first.safetyStatus).toBe('complete')
      expect(first.outcomes[0]).toMatchObject({ matchedOccurrences: 2, redactedOccurrences: 2 })
      expect(second.outputPath).not.toBe(first.outputPath)

      const mupdf = (await import('mupdf')).default
      const source = new mupdf.PDFDocument(new Uint8Array(await readFile(input)))
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(first.outputPath)))
      try {
        expect(output.countPages()).toBe(source.countPages())
        expect(output.getEmbeddedFiles()).toEqual({})
        let text = ''
        for (let page = 0; page < output.countPages(); page++) {
          text += output.loadPage(page).toStructuredText().asText()
          const object = output.loadPage(page).getObject()
          const annots = object.get('Annots')
          expect(annots.isNull() || (annots.isArray() && annots.length === 0)).toBe(true)
          expect(object.get('Rotate').isNull() || object.get('Rotate').asNumber() === 0).toBe(true)
        }
        expect(text).not.toContain('Mario Rossi')
      } finally { source.destroy(); output.destroy() }
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 60_000)
})
