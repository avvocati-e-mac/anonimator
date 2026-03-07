import fs from 'fs/promises'
import path from 'path'
import type { DetectedEntity } from '@shared/types'

/**
 * Normalizza le virgolette tipografiche e i trattini a caratteri ASCII standard.
 * Necessario perché il NER può rilevare "D'Angelo" con apostrofo dritto ma il
 * documento contiene "D'Angelo" con apostrofo curvo (U+2019).
 */
function normalizeQuotes(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // virgolette singole curve → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // virgolette doppie curve → "
    .replace(/[\u2013\u2014]/g, '-')             // en-dash / em-dash → -
}

/**
 * Sostituisce nel testo tutte le occorrenze delle entità confermate con il pseudonimo,
 * case-insensitive, e salva il risultato come [nome]_anonimizzato.txt.
 */
export async function generateTxt(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  // Prova UTF-8, fallback a latin1 per documenti legacy
  let original: string
  try {
    original = await fs.readFile(filePath, 'utf-8')
  } catch {
    const buf = await fs.readFile(filePath)
    original = buf.toString('latin1')
  }

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
 * Normalizza apostrofi e trattini tipografici prima della ricerca.
 */
export function replaceEntities(
  text: string,
  entities: DetectedEntity[]
): { text: string; count: number } {
  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  // Normalizza il testo del documento prima della ricerca
  let result = normalizeQuotes(text)
  let count = 0

  for (const entity of confirmed) {
    // Normalizza anche il testo dell'entità per fare match corretto
    const normalizedOriginal = normalizeQuotes(entity.originalText)
    const escaped = normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const matches = result.match(regex)
    if (matches && matches.length > 0) {
      result = result.replace(regex, entity.pseudonym)
      count++
    }
  }

  return { text: result, count }
}
