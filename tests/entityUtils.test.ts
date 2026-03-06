import { describe, it, expect } from 'vitest'
import { mergeEntities } from '../src/renderer/src/utils/entityUtils'
import type { DocumentAnalysisResult, DetectedEntity } from '../src/shared/types'

function makeEntity(overrides: Partial<DetectedEntity>): DetectedEntity {
  return {
    id: 'e1',
    type: 'PERSONA',
    originalText: 'Mario Rossi',
    pseudonym: 'M. R.',
    occurrences: 1,
    confirmed: true,
    ...overrides,
  }
}

function makeResult(entities: DetectedEntity[]): DocumentAnalysisResult {
  return { fileName: 'test.pdf', format: 'pdf', pageCount: 1, entities, warnings: [] }
}

describe('mergeEntities', () => {
  it('returns empty array for no results', () => {
    expect(mergeEntities([])).toEqual([])
  })

  it('returns entities from a single result unchanged', () => {
    const entity = makeEntity({ id: 'e1', originalText: 'Mario Rossi', occurrences: 3 })
    const merged = mergeEntities([makeResult([entity])])
    expect(merged).toHaveLength(1)
    expect(merged[0].occurrences).toBe(3)
    expect(merged[0].fileCount).toBe(1)
  })

  it('deduplicates same entity across two files and sums occurrences', () => {
    const e1 = makeEntity({ id: 'e1', originalText: 'Mario Rossi', occurrences: 2 })
    const e2 = makeEntity({ id: 'e2', originalText: 'mario rossi', occurrences: 5 })
    const merged = mergeEntities([makeResult([e1]), makeResult([e2])])
    expect(merged).toHaveLength(1)
    expect(merged[0].occurrences).toBe(7)
    expect(merged[0].fileCount).toBe(2)
    // Mantiene lo pseudonimo del primo
    expect(merged[0].pseudonym).toBe('M. R.')
  })

  it('keeps distinct entities separate', () => {
    const e1 = makeEntity({ id: 'e1', originalText: 'Mario Rossi', occurrences: 1 })
    const e2 = makeEntity({ id: 'e2', originalText: 'Luca Bianchi', occurrences: 1 })
    const merged = mergeEntities([makeResult([e1, e2])])
    expect(merged).toHaveLength(2)
    merged.forEach((e) => expect(e.fileCount).toBe(1))
  })

  it('sorts by occurrences descending', () => {
    const e1 = makeEntity({ id: 'e1', originalText: 'Mario Rossi', occurrences: 1 })
    const e2 = makeEntity({ id: 'e2', originalText: 'Luca Bianchi', occurrences: 10 })
    const merged = mergeEntities([makeResult([e1, e2])])
    expect(merged[0].originalText).toBe('Luca Bianchi')
    expect(merged[1].originalText).toBe('Mario Rossi')
  })

  it('sets fileCount=1 when entity appears in only one file', () => {
    const e1 = makeEntity({ id: 'e1', originalText: 'Solo Uno', occurrences: 3 })
    const e2 = makeEntity({ id: 'e2', originalText: 'Solo Due', occurrences: 1 })
    const merged = mergeEntities([makeResult([e1]), makeResult([e2])])
    merged.forEach((e) => expect(e.fileCount).toBe(1))
  })
})
