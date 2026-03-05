import fs from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'
import type { DetectedEntity } from '@shared/types'

/**
 * Anonimizza un ODT sostituendo il testo in content.xml.
 * Salva come [nome]_anonimizzato.odt.
 */
export async function generateOdt(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const buffer = await fs.readFile(filePath)
  const zip = new AdmZip(buffer)

  const entry = zip.getEntry('content.xml')
  if (!entry) throw new Error('Struttura ODT non valida: content.xml mancante.')

  const xmlContent = entry.getData().toString('utf-8')

  // Riusa la stessa logica XML del generatore DOCX
  const { text: anonymizedXml, count } = replaceEntitiesInXml(xmlContent, entities)

  zip.updateFile('content.xml', Buffer.from(anonymizedXml, 'utf-8'))

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.odt`)

  await fs.writeFile(outputPath, zip.toBuffer())
  return { outputPath, entitiesReplaced: count }
}

function replaceEntitiesInXml(
  xml: string,
  entities: DetectedEntity[]
): { text: string; count: number } {
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
