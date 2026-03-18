import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import AdmZip from 'adm-zip'
import { parseTxt } from '../src/main/parsers/txtParser'
import { parseDocx } from '../src/main/parsers/docxParser'
import { parseOdt } from '../src/main/parsers/odtParser'
import { detectFormat } from '../src/main/parsers/index'

const FIXTURES = join(__dirname, 'fixtures')

// ─── Helper: costruisce un DOCX minimo in memoria e lo scrive in un file tmp ──
function makeTempDocx(documentXml: string): string {
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  const zip = new AdmZip()
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf-8'))
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf-8'))
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'))
  const tmpPath = join(tmpdir(), `test-${randomUUID()}.docx`)
  zip.writeZip(tmpPath)
  return tmpPath
}

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

  it('run-split: testo spezzato su più w:t viene concatenato correttamente', async () => {
    // "MARIO ROSSI" spezzato in 3 run distinti
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">MAR</w:t></w:r>
      <w:r><w:t xml:space="preserve">IO </w:t></w:r>
      <w:r><w:t>ROSSI</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    const tmpPath = makeTempDocx(xml)
    try {
      const result = await parseDocx(tmpPath)
      expect(result.text).toContain('MARIO ROSSI')
    } finally {
      unlinkSync(tmpPath)
    }
  })

  it('paragrafo singolo run produce lo stesso testo del run-split equivalente', async () => {
    const xmlSingle = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>MARIO ROSSI</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const xmlSplit = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">MAR</w:t></w:r>
      <w:r><w:t xml:space="preserve">IO </w:t></w:r>
      <w:r><w:t>ROSSI</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    const p1 = makeTempDocx(xmlSingle)
    const p2 = makeTempDocx(xmlSplit)
    try {
      const r1 = await parseDocx(p1)
      const r2 = await parseDocx(p2)
      expect(r1.text.trim()).toBe(r2.text.trim())
    } finally {
      unlinkSync(p1)
      unlinkSync(p2)
    }
  })

  it('tabella 2x2: estrae il testo da tutte le celle', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Cella A1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Cella B1</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Cella A2</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Cella B2</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`
    const tmpPath = makeTempDocx(xml)
    try {
      const result = await parseDocx(tmpPath)
      expect(result.text).toContain('Cella A1')
      expect(result.text).toContain('Cella B1')
      expect(result.text).toContain('Cella A2')
      expect(result.text).toContain('Cella B2')
    } finally {
      unlinkSync(tmpPath)
    }
  })

  it('heading + corpo: estrae entrambi i paragrafi', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Titolo del documento</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Corpo del testo con Mario Rossi.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    const tmpPath = makeTempDocx(xml)
    try {
      const result = await parseDocx(tmpPath)
      expect(result.text).toContain('Titolo del documento')
      expect(result.text).toContain('Mario Rossi')
    } finally {
      unlinkSync(tmpPath)
    }
  })

  it('file DOCX corrotto lancia errore gestito', async () => {
    const tmpPath = join(tmpdir(), `corrupt-${randomUUID()}.docx`)
    writeFileSync(tmpPath, Buffer.from('questo non è uno zip', 'utf-8'))
    try {
      await expect(parseDocx(tmpPath)).rejects.toThrow()
    } finally {
      unlinkSync(tmpPath)
    }
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
