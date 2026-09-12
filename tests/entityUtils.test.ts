import { describe, it, expect } from 'vitest'
import { buildBatchAnonymizeRequests, mergeEntities } from '../src/renderer/src/utils/entityUtils'
import type { BatchFileItem, DocumentAnalysisResult, DetectedEntity } from '../src/shared/types'

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

function makeResult(entities: DetectedEntity[], analysisToken = 'token-1'): DocumentAnalysisResult {
  return { analysisToken, fileName: 'test.pdf', format: 'pdf', pageCount: 1, entities, warnings: [] }
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
    const merged = mergeEntities([makeResult([e1], 'token-1'), makeResult([e2], 'token-2')])
    expect(merged).toHaveLength(1)
    expect(merged[0].occurrences).toBe(7)
    expect(merged[0].fileCount).toBe(2)
    // Mantiene lo pseudonimo del primo
    expect(merged[0].pseudonym).toBe('M. R.')
    expect(merged[0].references).toEqual([
      { analysisToken: 'token-1', entityId: 'e1' },
      { analysisToken: 'token-2', entityId: 'e2' }
    ])
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

describe('buildBatchAnonymizeRequests', () => {
  const files: BatchFileItem[] = [
    { filePath: '/a.pdf', fileName: 'a.pdf', status: 'done', analysisResult: makeResult([], 'token-a') },
    { filePath: '/b.pdf', fileName: 'b.pdf', status: 'done', analysisResult: makeResult([], 'token-b') }
  ]

  it('usa l ID specifico di ogni documento e propaga la modifica aggregata', () => {
    const [merged] = mergeEntities([
      makeResult([makeEntity({ id: 'id-a' })], 'token-a'),
      makeResult([makeEntity({ id: 'id-b' })], 'token-b')
    ])
    merged.pseudonym = 'Persona 7'
    const requests = buildBatchAnonymizeRequests(files, [merged], 'force-bitonal')
    expect(requests.map((request) => request.analysisToken)).toEqual(['token-a', 'token-b'])
    expect(requests.map((request) => request.entities[0].entityId)).toEqual(['id-a', 'id-b'])
    expect(requests.map((request) => request.entities[0].pseudonym)).toEqual(['Persona 7', 'Persona 7'])
    expect(requests.map((request) => request.pdfOutputMode)).toEqual(['force-bitonal', 'force-bitonal'])
  })

  it('applica manuali/importate a tutti e omette le rilevate assenti', () => {
    const [detected] = mergeEntities([makeResult([makeEntity({ id: 'only-a' })], 'token-a')])
    const manual = {
      ...makeEntity({ id: 'manual-1', originalText: 'Persona Mancante' }),
      fileCount: 0,
      references: [],
      applyToAll: true
    }
    const requests = buildBatchAnonymizeRequests(files, [detected, manual])
    expect(requests.every((request) => request.pdfOutputMode === 'preserve-color')).toBe(true)
    expect(requests[0].entities.map((entity) => entity.entityId)).toEqual(['only-a', 'manual-1'])
    expect(requests[1].entities.map((entity) => entity.entityId)).toEqual(['manual-1'])
  })
})
