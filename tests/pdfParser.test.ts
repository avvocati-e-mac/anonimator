import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'

const FIXTURES = join(__dirname, 'fixtures')

// Mock electron — non c'è finestra Electron in vitest
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() }
}))

describe('parsePdf', () => {
  it('estrae testo da PDF nativo', async () => {
    const { parsePdf } = await import('../src/main/parsers/pdfParser')
    const result = await parsePdf(join(FIXTURES, 'sample.pdf'))
    expect(result.text).toContain('Mario Rossi')
    expect(result.text).toContain('RSSMRA80A01H501U')
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  }, 15000)

  it('PDF nativo non viene marcato come scansionato', async () => {
    const { parsePdf } = await import('../src/main/parsers/pdfParser')
    const result = await parsePdf(join(FIXTURES, 'sample.pdf'))
    expect(result.isScanned).toBe(false)
  }, 15000)

  it('lancia errore su file non PDF', async () => {
    const { parsePdf } = await import('../src/main/parsers/pdfParser')
    await expect(parsePdf(join(FIXTURES, 'sample.txt'))).rejects.toThrow()
  }, 15000)
})

// I test OCR (parseImage, parsePdfWithOcr) richiedono resources/tessdata/ita.traineddata
// che viene aggiunto nella Fase 6 (packaging). Testati manualmente nell'app.
