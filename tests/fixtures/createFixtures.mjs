// Script per generare i file di fixture DOCX e ODT per i test
// Eseguito una tantum con: node tests/fixtures/createFixtures.mjs

import AdmZip from 'adm-zip'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SAMPLE_TEXT = 'Il sig. Mario Rossi, C.F. RSSMRA80A01H501U, residente in Roma, cita la società Alfa SRL, P.IVA 12345678901.'

// ─── DOCX ────────────────────────────────────────────────────────────────────
function makeDocx(text) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t xml:space="preserve">${text}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>IBAN: IT60X0542811101000000123456</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`

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
  zip.addFile('word/document.xml', Buffer.from(xml, 'utf-8'))
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf-8'))
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'))
  zip.writeZip(join(__dirname, 'sample.docx'))
  console.log('sample.docx creato')
}

// ─── ODT ─────────────────────────────────────────────────────────────────────
function makeOdt(text) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:text>
      <text:p>${text}</text:p>
      <text:p>email: test@example.it, tel. 333 1234567</text:p>
    </office:text>
  </office:body>
</office:document-content>`

  const mimetype = 'application/vnd.oasis.opendocument.text'

  const zip = new AdmZip()
  // Il mimetype deve essere il primo file e non compresso (spec ODT)
  zip.addFile('mimetype', Buffer.from(mimetype, 'utf-8'))
  zip.addFile('content.xml', Buffer.from(xml, 'utf-8'))
  zip.writeZip(join(__dirname, 'sample.odt'))
  console.log('sample.odt creato')
}

makeDocx(SAMPLE_TEXT)
makeOdt(SAMPLE_TEXT)
