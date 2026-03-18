import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import AdmZip from 'adm-zip'
import { generateDocx } from '../src/main/outputGenerators/docxGenerator'
import type { DetectedEntity } from '../src/shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(originalText: string, pseudonym: string, type: DetectedEntity['type'] = 'PERSONA'): DetectedEntity {
  return {
    id: randomUUID(),
    type,
    originalText,
    pseudonym,
    occurrences: 1,
    confirmed: true,
  }
}

/** Crea un DOCX minimo con il document.xml specificato, scrive in tmp, ritorna il path. */
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
  const tmpPath = join(tmpdir(), `test-gen-${randomUUID()}.docx`)
  zip.writeZip(tmpPath)
  return tmpPath
}

/** Estrae il contenuto di word/document.xml dall'output anonimizzato. */
function extractDocumentXml(outputPath: string): string {
  const buf = readFileSync(outputPath)
  const zip = new AdmZip(buf)
  const entry = zip.getEntry('word/document.xml')
  if (!entry) throw new Error('word/document.xml non trovato')
  return entry.getData().toString('utf-8')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateDocx — sostituzione singola entità', () => {
  it('sostituisce una singola entità in un singolo <w:t>', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Mario Rossi ha firmato.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath, entitiesReplaced } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('PERSONA_001')
        expect(outXml).not.toContain('Mario Rossi')
        expect(outXml).toContain('ha firmato')
        expect(entitiesReplaced).toBe(1)
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('sostituisce entità in run-split (più <w:t>)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">Mar</w:t></w:r>
      <w:r><w:t xml:space="preserve">io </w:t></w:r>
      <w:r><w:t>Rossi</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('PERSONA_001')
        expect(outXml).not.toContain('Mario Rossi')
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })
})

describe('generateDocx — multi-entità stesso paragrafo (bug regression)', () => {
  it('sostituisce due entità nello stesso <w:t> senza perdere testo', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Attore: Mario Rossi, CF: RSSMRA80A01H501U.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath, entitiesReplaced } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
        makeEntity('RSSMRA80A01H501U', 'CF_001', 'CODICE_FISCALE'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('PERSONA_001')
        expect(outXml).toContain('CF_001')
        expect(outXml).not.toContain('Mario Rossi')
        expect(outXml).not.toContain('RSSMRA80A01H501U')
        // Il testo non-entità deve sopravvivere
        expect(outXml).toContain('Attore:')
        expect(entitiesReplaced).toBe(2)
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('sostituisce tre entità nello stesso <w:t> preservando il testo circostante', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Nome: Mario Rossi, email: mario@example.it, tel: 333 1234567.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath, entitiesReplaced } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
        makeEntity('mario@example.it', 'EMAIL_001', 'EMAIL'),
        makeEntity('333 1234567', 'TEL_001', 'TELEFONO'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('PERSONA_001')
        expect(outXml).toContain('EMAIL_001')
        expect(outXml).toContain('TEL_001')
        expect(outXml).not.toContain('Mario Rossi')
        expect(outXml).not.toContain('mario@example.it')
        expect(outXml).not.toContain('333 1234567')
        expect(outXml).toContain('Nome:')
        expect(outXml).toContain('email:')
        expect(outXml).toContain('tel:')
        expect(entitiesReplaced).toBe(3)
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('due entità in run-split distinti vengono entrambe sostituite', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">Attore: Mario Rossi, </w:t></w:r>
      <w:r><w:t>convenuto: Luigi Bianchi.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath, entitiesReplaced } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
        makeEntity('Luigi Bianchi', 'PERSONA_002'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('PERSONA_001')
        expect(outXml).toContain('PERSONA_002')
        expect(outXml).not.toContain('Mario Rossi')
        expect(outXml).not.toContain('Luigi Bianchi')
        expect(outXml).toContain('Attore:')
        expect(outXml).toContain('convenuto:')
        expect(entitiesReplaced).toBe(2)
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('entità più lunga ha priorità su entità più corta sovrapposta', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Firmato da Giuseppe Verdi avv.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath } = await generateDocx(inputPath, [
        makeEntity('Giuseppe Verdi', 'PERSONA_001'),
        makeEntity('Verdi', 'PERSONA_002', 'ORGANIZZAZIONE'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        // Solo una sostituzione, quella più lunga
        expect(outXml).toContain('PERSONA_001')
        expect(outXml).not.toContain('Giuseppe Verdi')
        // Il cognome singolo non deve comparire come pseudonimo separato
        expect(outXml).not.toContain('PERSONA_002')
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('entità non confermata non viene sostituita', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Il sig. Mario Rossi è presente.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const entity = makeEntity('Mario Rossi', 'PERSONA_001')
      entity.confirmed = false
      const { outputPath } = await generateDocx(inputPath, [entity])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('Mario Rossi')
        expect(outXml).not.toContain('PERSONA_001')
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })
})

describe('generateDocx — casi limite', () => {
  it('paragrafo senza entità rimane invariato', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Testo senza dati sensibili.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath, entitiesReplaced } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('Testo senza dati sensibili.')
        expect(entitiesReplaced).toBe(0)
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('output path è [nome]_anonimizzato.docx', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Testo.</w:t></w:r></w:p></w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath } = await generateDocx(inputPath, [])
      try {
        expect(outputPath).toMatch(/_anonimizzato\.docx$/)
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })

  it('testo con caratteri speciali XML viene escaped correttamente', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Ditta &amp; Soci s.r.l. con Mario Rossi.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const inputPath = makeTempDocx(xml)
    try {
      const { outputPath } = await generateDocx(inputPath, [
        makeEntity('Mario Rossi', 'PERSONA_001'),
      ])
      try {
        const outXml = extractDocumentXml(outputPath)
        expect(outXml).toContain('PERSONA_001')
        // Il & deve restare escaped nell'XML
        expect(outXml).toContain('&amp;')
      } finally {
        unlinkSync(outputPath)
      }
    } finally {
      unlinkSync(inputPath)
    }
  })
})
