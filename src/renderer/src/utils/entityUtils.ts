import type { DetectedEntity, DocumentAnalysisResult } from '@shared/types'

/**
 * Unisce le entità rilevate da più documenti in una lista deduplicata.
 * - Deduplicazione per originalText (case-insensitive)
 * - Somma occurrences tra file diversi
 * - fileCount = numero di file in cui l'entità compare
 * - Mantiene il primo pseudonym trovato (sessionManager garantisce coerenza)
 * - Ordina per occurrences desc
 */
export function mergeEntities(results: DocumentAnalysisResult[]): DetectedEntity[] {
  const map = new Map<string, DetectedEntity & { fileCount: number }>()

  for (const result of results) {
    for (const entity of result.entities) {
      const key = entity.originalText.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.occurrences += entity.occurrences
        existing.fileCount += 1
      } else {
        map.set(key, { ...entity, fileCount: 1 })
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.occurrences - a.occurrences)
}
