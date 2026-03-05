import fs from 'fs/promises'
import path from 'path'
import type { DetectedEntity } from '@shared/types'

/**
 * Sostituisce nel testo tutte le occorrenze delle entità confermate con il pseudonimo,
 * case-insensitive, e salva il risultato come [nome]_anonimizzato.txt.
 */
export async function generateTxt(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const original = await fs.readFile(filePath, 'utf-8')
  const { text: anonymized, count } = replaceEntities(original, entities)

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.txt`)

  await fs.writeFile(outputPath, anonymized, 'utf-8')
  return { outputPath, entitiesReplaced: count }
}

/**
 * Sostituisce le entità nel testo, ordinando per lunghezza decrescente per evitare
 * sostituzioni parziali (es. "Rossi" prima di "Mario Rossi").
 */
export function replaceEntities(
  text: string,
  entities: DetectedEntity[]
): { text: string; count: number } {
  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  let result = text
  let count = 0

  for (const entity of confirmed) {
    const escaped = entity.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const matches = result.match(regex)
    if (matches && matches.length > 0) {
      result = result.replace(regex, entity.pseudonym)
      count++
    }
  }

  return { text: result, count }
}
