import { describe, it, expect } from 'vitest'
import { LEGAL_STOP_WORDS } from '../src/main/services/legalStopWords'
import type { DetectedEntity } from '../src/shared/types'

// Helper che riproduce la logica del veto filter in nerService.ts
function applyLegalStopWordsFilter(entities: DetectedEntity[]): DetectedEntity[] {
  return entities.filter(e =>
    !(e.type === 'PERSONA' && e.source === 'ner' && LEGAL_STOP_WORDS.has(e.text ?? e.originalText.toLowerCase()))
  )
}

// Versione semplificata che usa originalText.toLowerCase()
function applyFilter(entities: DetectedEntity[]): DetectedEntity[] {
  return entities.filter(e =>
    !(e.type === 'PERSONA' && e.source === 'ner' && LEGAL_STOP_WORDS.has(e.originalText.toLowerCase()))
  )
}

function makeEntity(originalText: string, source: DetectedEntity['source'] = 'ner', type: DetectedEntity['type'] = 'PERSONA'): DetectedEntity {
  return {
    id: `test_${originalText}`,
    type,
    originalText,
    pseudonym: '',
    occurrences: 1,
    confirmed: true,
    source,
  }
}

describe('LEGAL_STOP_WORDS — contenuto', () => {
  it('contiene ruoli processuali civili', () => {
    expect(LEGAL_STOP_WORDS.has('ricorrente')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('appellante')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('resistente')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('convenuto')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('attore')).toBe(true)
  })
  it('contiene ruoli processuali penali', () => {
    expect(LEGAL_STOP_WORDS.has('imputato')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('querelante')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('indagato')).toBe(true)
  })
  it('contiene ruoli giudiziari', () => {
    expect(LEGAL_STOP_WORDS.has('presidente')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('giudice')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('cancelliere')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('relatore')).toBe(true)
  })
  it('contiene organi e enti', () => {
    expect(LEGAL_STOP_WORDS.has('tribunale')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('procura')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('ministero')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('questura')).toBe(true)
    expect(LEGAL_STOP_WORDS.has('prefettura')).toBe(true)
  })
  it('è tutto in lowercase', () => {
    for (const word of LEGAL_STOP_WORDS) {
      expect(word).toBe(word.toLowerCase())
    }
  })
})

describe('applyLegalStopWordsFilter — veto su entità NER', () => {
  it('filtra entità PERSONA con source ner che è nella stop list', () => {
    const entities = [makeEntity('RICORRENTE')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(0)
  })

  it('filtra anche se il testo è in maiuscolo (lowercase check)', () => {
    const entities = [makeEntity('APPELLANTE')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(0)
  })

  it('filtra anche in minuscolo', () => {
    const entities = [makeEntity('imputato')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(0)
  })

  it('NON filtra entità PERSONA reali con source ner', () => {
    const entities = [makeEntity('Mario Rossi')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(1)
  })

  it('NON filtra entità PERSONA con source regex (solo NER è soggetto al veto)', () => {
    const entities = [makeEntity('RICORRENTE', 'regex')]
    const filtered = applyFilter(entities)
    // source regex → non filtrato (pattern step 0b non produce mai "RICORRENTE" standalone)
    expect(filtered).toHaveLength(1)
  })

  it('NON filtra entità ORGANIZZAZIONE anche se nella stop list', () => {
    const entities = [makeEntity('tribunale', 'ner', 'ORGANIZZAZIONE')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(1)
  })

  it('NON filtra entità LUOGO', () => {
    const entities = [makeEntity('questura', 'ner', 'LUOGO')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(1)
  })

  it('filtro esatto — NON filtra nomi che contengono una stop word come prefisso', () => {
    // "Presidente Rossi" non è nella stop list (exact match lowercase)
    const entities = [makeEntity('Presidente Rossi')]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(1)
  })

  it('gestisce un mix di entità filtrabili e non', () => {
    const entities = [
      makeEntity('RICORRENTE'),       // filtrato
      makeEntity('Mario Rossi'),      // mantenuto
      makeEntity('APPELLANTE'),       // filtrato
      makeEntity('Anna Bianchi'),     // mantenuto
      makeEntity('imputato'),         // filtrato
    ]
    const filtered = applyFilter(entities)
    expect(filtered).toHaveLength(2)
    expect(filtered.map(e => e.originalText)).toContain('Mario Rossi')
    expect(filtered.map(e => e.originalText)).toContain('Anna Bianchi')
  })
})
