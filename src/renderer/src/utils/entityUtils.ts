import type {
  BatchAnonymizeRequest, BatchFileItem, DetectedEntity, DocumentAnalysisResult, EntityDecision,
  PdfOutputMode
} from '@shared/types'

export interface EntityReference {
  analysisToken: string
  entityId: string
}

export interface MergedEntity extends DetectedEntity {
  fileCount: number
  /** Riferimenti opachi alle entita' originali, distinti per documento. */
  references: EntityReference[]
  /** Manuali/importate vanno tentate su ogni documento del batch. */
  applyToAll: boolean
}

export function toEntityDecision(entity: DetectedEntity, entityId = entity.id): EntityDecision {
  return {
    entityId,
    type: entity.type,
    originalText: entity.originalText,
    pseudonym: entity.pseudonym,
    confirmed: entity.confirmed
  }
}

export function buildBatchAnonymizeRequests(
  files: readonly BatchFileItem[],
  entities: readonly MergedEntity[],
  pdfOutputMode: PdfOutputMode = 'preserve-color',
): BatchAnonymizeRequest[] {
  return files.flatMap((file) => {
    const analysisToken = file.analysisResult?.analysisToken
    if (!analysisToken) return []
    const decisions = entities.flatMap((entity) => {
      const reference = entity.references.find((ref) => ref.analysisToken === analysisToken)
      if (reference) return [toEntityDecision(entity, reference.entityId)]
      if (entity.applyToAll) return [toEntityDecision(entity)]
      return []
    })
    return [{ analysisToken, entities: decisions, pdfOutputMode }]
  })
}

/**
 * Unisce le entità rilevate da più documenti in una lista deduplicata.
 * - Deduplicazione per originalText (case-insensitive)
 * - Somma occurrences tra file diversi
 * - fileCount = numero di file in cui l'entità compare
 * - Mantiene il primo pseudonym trovato (sessionManager garantisce coerenza)
 * - Ordina per occurrences desc
 */
export function mergeEntities(results: DocumentAnalysisResult[]): MergedEntity[] {
  const map = new Map<string, MergedEntity>()

  for (const result of results) {
    for (const entity of result.entities) {
      const key = entity.originalText.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.occurrences += entity.occurrences
        existing.fileCount += 1
        existing.references.push({ analysisToken: result.analysisToken, entityId: entity.id })
      } else {
        map.set(key, {
          ...entity,
          fileCount: 1,
          references: [{ analysisToken: result.analysisToken, entityId: entity.id }],
          applyToAll: false
        })
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.occurrences - a.occurrences)
}
