import fs from 'fs/promises'
import path from 'path'
import type { DetectedEntity } from '@shared/types'
import { replaceEntities } from './txtGenerator'

/**
 * Anonimizza un file Markdown preservando la sintassi (heading, bold, link, ecc.).
 * Il NER lavora sul testo plain estratto da markdownParser, ma le entità rilevate
 * appaiono anche nel Markdown originale → la sostituzione funziona direttamente.
 * Salva come [nome]_anonimizzato.md.
 */
export async function generateMarkdown(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const original = await fs.readFile(filePath, 'utf-8')
  const { text: anonymized, count } = replaceEntities(original, entities)

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.md`)

  await fs.writeFile(outputPath, anonymized, 'utf-8')
  return { outputPath, entitiesReplaced: count }
}
