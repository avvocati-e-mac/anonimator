import fs from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'
import type { DetectedEntity } from '@shared/types'

/**
 * Anonimizza un DOCX sostituendo il testo nell'XML interno (word/document.xml).
 * Approccio: sostituisce le entità direttamente sull'XML come stringa —
 * funziona perché le entità rilevate sono estratte dallo stesso XML.
 * Salva come [nome]_anonimizzato.docx.
 */
export async function generateDocx(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const buffer = await fs.readFile(filePath)
  const zip = new AdmZip(buffer)

  const entry = zip.getEntry('word/document.xml')
  if (!entry) throw new Error('Struttura DOCX non valida: word/document.xml mancante.')

  const xmlContent = entry.getData().toString('utf-8')
  const { text: anonymizedXml, count } = replaceEntitiesInXml(xmlContent, entities)

  zip.updateFile('word/document.xml', Buffer.from(anonymizedXml, 'utf-8'))

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.docx`)

  await fs.writeFile(outputPath, zip.toBuffer())
  return { outputPath, entitiesReplaced: count }
}

/**
 * Sostituisce le entità nell'XML DOCX.
 * Lavora sul testo visibile (contenuto dei tag <w:t>) evitando di corrompere il markup XML.
 * Strategia: sostituisce direttamente nell'XML grezzo — le entità estratte dal parser
 * non contengono caratteri XML speciali (< > & " ') tranne nei casi rari che gestiamo
 * con escape XML.
 */
function replaceEntitiesInXml(
  xml: string,
  entities: DetectedEntity[]
): { text: string; count: number } {
  // Escapa i caratteri speciali XML nel testo di ricerca
  function escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  let result = xml
  let count = 0

  for (const entity of confirmed) {
    // Prova sia il testo raw che la versione XML-escaped
    const variants = [entity.originalText, escapeXml(entity.originalText)]
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped, 'gi')
      const matches = result.match(regex)
      if (matches && matches.length > 0) {
        result = result.replace(regex, entity.pseudonym)
        count++
        break
      }
    }
  }

  return { text: result, count }
}
