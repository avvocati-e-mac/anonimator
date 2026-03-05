import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { parseTxt } from '../src/main/parsers/txtParser'
import { parseDocx } from '../src/main/parsers/docxParser'
import { parseOdt } from '../src/main/parsers/odtParser'
import { detectFormat } from '../src/main/parsers/index'

const FIXTURES = join(__dirname, 'fixtures')

// ─── detectFormat ─────────────────────────────────────────────────────────────
describe('detectFormat', () => {
  it('riconosce .pdf', () => expect(detectFormat('doc.pdf')).toBe('pdf'))
  it('riconosce .docx', () => expect(detectFormat('atto.docx')).toBe('docx'))
  it('riconosce .odt', () => expect(detectFormat('contratto.odt')).toBe('odt'))
  it('riconosce .txt', () => expect(detectFormat('note.txt')).toBe('txt'))
  it('riconosce .png', () => expect(detectFormat('scan.png')).toBe('image'))
  it('riconosce .jpg maiuscolo', () => expect(detectFormat('FOTO.JPG')).toBe('image'))
})

// ─── TXT Parser ───────────────────────────────────────────────────────────────
describe('parseTxt', () => {
  it('estrae il testo correttamente', async () => {
    const result = await parseTxt(join(FIXTURES, 'sample.txt'))
    expect(result.text).toContain('ATTO DI CITAZIONE')
    expect(result.text).toContain('Mario Rossi')
    expect(result.text).toContain('RSSMRA80A01H501U')
    expect(result.text).toContain('IT60X0542811101000000123456')
  })

  it('pageCount è almeno 1', async () => {
    const result = await parseTxt(join(FIXTURES, 'sample.txt'))
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('non genera warnings su file valido', async () => {
    const result = await parseTxt(join(FIXTURES, 'sample.txt'))
    expect(result.warnings).toHaveLength(0)
  })

  it('lancia errore su file inesistente', async () => {
    await expect(parseTxt('/tmp/non-esiste.txt')).rejects.toThrow()
  })
})

// ─── DOCX Parser ─────────────────────────────────────────────────────────────
describe('parseDocx', () => {
  it('estrae il testo correttamente', async () => {
    const result = await parseDocx(join(FIXTURES, 'sample.docx'))
    expect(result.text).toContain('Mario Rossi')
    expect(result.text).toContain('RSSMRA80A01H501U')
    expect(result.text).toContain('IT60X0542811101000000123456')
  })

  it('pageCount è almeno 1', async () => {
    const result = await parseDocx(join(FIXTURES, 'sample.docx'))
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('il testo non è vuoto', async () => {
    const result = await parseDocx(join(FIXTURES, 'sample.docx'))
    expect(result.text.trim().length).toBeGreaterThan(0)
  })

  it('lancia errore su file non DOCX', async () => {
    await expect(parseDocx(join(FIXTURES, 'sample.txt'))).rejects.toThrow()
  })
})

// ─── ODT Parser ──────────────────────────────────────────────────────────────
describe('parseOdt', () => {
  it('estrae il testo correttamente', async () => {
    const result = await parseOdt(join(FIXTURES, 'sample.odt'))
    expect(result.text).toContain('Mario Rossi')
    expect(result.text).toContain('RSSMRA80A01H501U')
  })

  it('riconosce email e telefono nel testo estratto', async () => {
    const result = await parseOdt(join(FIXTURES, 'sample.odt'))
    expect(result.text).toContain('test@example.it')
    expect(result.text).toContain('333 1234567')
  })

  it('pageCount è almeno 1', async () => {
    const result = await parseOdt(join(FIXTURES, 'sample.odt'))
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('lancia errore su file non ODT', async () => {
    await expect(parseOdt(join(FIXTURES, 'sample.txt'))).rejects.toThrow()
  })
})
