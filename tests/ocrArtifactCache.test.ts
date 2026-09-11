import { afterEach, describe, expect, it } from 'vitest'
import {
  OcrArtifactCache,
  OcrArtifactCacheLimitError,
  estimateOcrArtifactBytes,
  ocrArtifactCache,
  type OcrDocumentArtifact,
} from '../src/main/services/ocrArtifactCache'

function artifact(text = 'Mario'): OcrDocumentArtifact {
  return {
    pages: [{
      page: 1,
      renderMatrix: [2, 0, 0, 2, 0, 0],
      pixmapOrigin: { x: 4, y: 8 },
      words: [{
        text,
        bbox: { x0: 10, y0: 20, x1: 30, y1: 40 },
        confidence: 92,
        line: 1,
        page: 1,
      }],
    }],
  }
}

afterEach(() => ocrArtifactCache.clear())

describe('OcrArtifactCache', () => {
  it('stima deterministicamente byte e lunghezza UTF-8', () => {
    expect(estimateOcrArtifactBytes(artifact('Mario'))).toBe(64 + 96 + 96 + 5)
    expect(estimateOcrArtifactBytes(artifact('è'))).toBe(64 + 96 + 96 + 2)
  })

  it('lega uno staging handle al token senza serializzare su disco', () => {
    const cache = new OcrArtifactCache(1_024)
    const handle = cache.stage(artifact())
    expect(cache.stats()).toMatchObject({ pending: 1, active: 0 })
    cache.bind(handle, 'token-1')
    expect(cache.get('token-1')?.pages[0].words[0].text).toBe('Mario')
    expect(cache.stats()).toMatchObject({ pending: 0, active: 1 })
  })

  it('non espelle token attivi e rifiuta una nuova analisi oltre il cap', () => {
    const bytes = estimateOcrArtifactBytes(artifact())
    const cache = new OcrArtifactCache(bytes + 1)
    const handle = cache.stage(artifact())
    cache.bind(handle, 'active-token')
    expect(() => cache.stage(artifact('Rossi'))).toThrowError(OcrArtifactCacheLimitError)
    expect(cache.get('active-token')).toBeDefined()
    expect(cache.stats().active).toBe(1)
  })

  it('release e clear restituiscono integralmente il budget', () => {
    const cache = new OcrArtifactCache(2_048)
    const first = cache.stage(artifact())
    cache.bind(first, 'token-1')
    const pending = cache.stage(artifact('Rossi'))
    expect(cache.stats().usedBytes).toBeGreaterThan(0)
    cache.release('token-1')
    cache.discard(pending)
    expect(cache.stats()).toMatchObject({ active: 0, pending: 0, usedBytes: 0 })
  })
})
