import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import AdmZip from 'adm-zip'
import { parseTxt } from '../src/main/parsers/txtParser'
import { parseDocx } from '../src/main/parsers/docxParser'
import { parseOdt } from '../src/main/parsers/odtParser'
import {
  detectFormat,
  buildOcrParseOptions,
  reportAfterForcedOcr
} from '../src/main/parsers/index'
import type {
  ImageQualityReason,
  ImageQualityVerdict,
  OcrLayerReport,
  OcrLayerVerdict,
  TextQualityVerdict
} from '@shared/types'

/** Report minimo e realistico, da variare campo per campo nei singoli test. */
function makeReport(over: {
  verdict?: OcrLayerVerdict
  suggestedOcrDpi?: number
  skewDeg?: number
  imageQuality?: ImageQualityVerdict
  imageQualityReasons?: ImageQualityReason[]
  textQuality?: TextQualityVerdict
}): OcrLayerReport {
  return {
    layerKind: 'scan-with-text',
    verdict: over.verdict ?? 'aligned',
    pagesSampled: 5,
    pagesMisaligned: 0,
    pagesInconclusive: 0,
    maxOffsetMm: 1.2,
    producerFont: 'GlyphLessFont',
    pages: [
      {
        page: 1,
        verdict: over.verdict ?? 'aligned',
        reason: 'ok',
        coverage: 0.9,
        lift: 2,
        lineAgreement: 0.8,
        scaleY: 1,
        offsetXPt: 0,
        offsetYPt: 0
      }
    ],
    textQuality: over.textQuality ?? 'good',
    textQualityReasons: [],
    imageQuality: over.imageQuality ?? 'good',
    imageQualityReasons: over.imageQualityReasons ?? [],
    imageMetrics: {
      nativeDpi: 300,
      xHeightPx: 20,
      separability: 0.8,
      skewDeg: over.skewDeg ?? 0,
      blurScore: 0.5
    },
    suggestedOcrDpi: over.suggestedOcrDpi ?? 300,
    elapsedMs: 120
  }
}

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

// ─── Opzioni di rendering OCR derivate dal report ────────────────────────────

describe('buildOcrParseOptions — dal report alle opzioni di rendering', () => {
  it('senza report non impone nulla: DPI, skew e Sauvola restano indefiniti', () => {
    const opts = buildOcrParseOptions(undefined)
    expect(opts.dpi).toBeUndefined()
    expect(opts.skewDeg).toBeUndefined()
    expect(opts.unevenLighting).toBe(false)
  })

  it('usa il DPI suggerito dal report e l\'inclinazione misurata', () => {
    const opts = buildOcrParseOptions(makeReport({ suggestedOcrDpi: 240, skewDeg: 3.5 }))
    expect(opts.dpi).toBe(240)
    expect(opts.skewDeg).toBe(3.5)
  })

  it('il DPI esplicito del chiamante ha la precedenza su quello suggerito', () => {
    const opts = buildOcrParseOptions(makeReport({ suggestedOcrDpi: 240 }), 400)
    expect(opts.dpi).toBe(400)
  })

  it('attiva Sauvola solo quando la separabilità è risultata bassa', () => {
    expect(buildOcrParseOptions(makeReport({})).unevenLighting).toBe(false)
    expect(
      buildOcrParseOptions(makeReport({ imageQualityReasons: ['low-separability'] })).unevenLighting
    ).toBe(true)
  })

  it('non attiva Sauvola per un difetto diverso dalla separabilità', () => {
    expect(
      buildOcrParseOptions(makeReport({ imageQualityReasons: ['low-native-dpi'] })).unevenLighting
    ).toBe(false)
  })
})

// ─── Report dopo un OCR rifatto da noi ───────────────────────────────────────

describe('reportAfterForcedOcr — il report dopo un nuovo riconoscimento', () => {
  const PROSA_BUONA =
    'Il Tribunale di Cittafinta, riunito in camera di consiglio, ha pronunciato la seguente ' +
    'ordinanza nella causa civile promossa dal ricorrente contro il resistente, avendo esaminato ' +
    'gli atti e sentite le parti, e ritenuto che la domanda sia fondata nei limiti che seguono.'

  it('senza report di partenza non ne inventa uno', () => {
    expect(reportAfterForcedOcr(undefined, PROSA_BUONA)).toBeUndefined()
  })

  it('declassa il layer a scan-no-text e il verdetto a inconclusive', () => {
    // Il layer preesistente non viene più letto: dichiararlo 'aligned'
    // instraderebbe l'output sul percorso veloce page.search() sopra un layer
    // che non stiamo più usando.
    const r = reportAfterForcedOcr(makeReport({ verdict: 'misaligned' }), PROSA_BUONA)
    expect(r?.layerKind).toBe('scan-no-text')
    expect(r?.verdict).toBe('inconclusive')
    expect(r?.maxOffsetMm).toBe(0)
    expect(r?.pages).toEqual([])
  })

  it('conserva la qualità dell\'immagine: una scansione a 100 DPI lo resta', () => {
    const r = reportAfterForcedOcr(
      makeReport({ imageQuality: 'poor', imageQualityReasons: ['very-low-native-dpi'] }),
      PROSA_BUONA
    )
    expect(r?.imageQuality).toBe('poor')
    expect(r?.imageQualityReasons).toEqual(['very-low-native-dpi'])
  })

  it('ricalcola la qualità del testo su quello che abbiamo prodotto noi', () => {
    const buono = reportAfterForcedOcr(makeReport({ textQuality: 'poor' }), PROSA_BUONA)
    expect(buono?.textQuality).toBe('good')

    // OCR fallito su scansione illeggibile: tanti token, nessuna parola vera.
    const spazzatura = reportAfterForcedOcr(
      makeReport({ textQuality: 'good' }),
      'x '.repeat(30) + 'zx kq xw vz qj bx wq zk jv xq nn tt rr ss dd ff gg hh kk ll mm pp'
    )
    expect(spazzatura?.textQuality).toBe('poor')
  })

  it('non lascia trapelare testo del documento nel report', () => {
    const r = reportAfterForcedOcr(makeReport({}), 'Mario Rossi RSSMRA80A01H501U')
    expect(JSON.stringify(r)).not.toMatch(/Mario Rossi|RSSMRA80A01H501U/)
  })
})
