import { describe, it, expect } from 'vitest'
import { expandCoReferences } from '../src/main/services/nerService'
import type { DetectedEntity } from '../src/shared/types'

function makePersona(text: string, source: DetectedEntity['source'] = 'ner', pseudonym = 'M. R.'): DetectedEntity {
  return {
    id: `test_${text}`,
    type: 'PERSONA',
    originalText: text,
    pseudonym,
    occurrences: 1,
    confirmed: true,
    source,
  }
}

describe('expandCoReferences', () => {
  it('aggiunge token co-referenziale con ≥ 2 occorrenze standalone', () => {
    const text = 'Mario Rossi è il ricorrente. Rossi ha presentato istanza. Rossi ha poi integrato.'
    const entities = [makePersona('Mario Rossi')]
    const expanded = expandCoReferences(entities, text)
    const coref = expanded.find(e => e.originalText === 'Rossi')
    expect(coref).toBeDefined()
    expect(coref?.source).toBe('coref')
  })

  it('il token co-referenziale eredita il pseudonimo del padre', () => {
    const text = 'Anna Bianchi ha firmato. Bianchi ha confermato. Bianchi era presente.'
    const entities = [makePersona('Anna Bianchi', 'ner', 'A. B.')]
    const expanded = expandCoReferences(entities, text)
    const coref = expanded.find(e => e.originalText === 'Bianchi')
    expect(coref?.pseudonym).toBe('A. B.')
  })

  it('non aggiunge token con < 2 occorrenze', () => {
    const text = 'Mario Rossi ha firmato il documento.'
    const entities = [makePersona('Mario Rossi')]
    const expanded = expandCoReferences(entities, text)
    expect(expanded.find(e => e.originalText === 'Rossi')).toBeUndefined()
    expect(expanded.find(e => e.originalText === 'Mario')).toBeUndefined()
  })

  it('non aggiunge token già presenti come entità autonome', () => {
    const text = 'Mario Rossi. Rossi ha detto. Rossi conferma.'
    const entities = [
      makePersona('Mario Rossi'),
      makePersona('Rossi'), // già presente
    ]
    const expanded = expandCoReferences(entities, text)
    const rossiEntities = expanded.filter(e => e.originalText === 'Rossi')
    expect(rossiEntities).toHaveLength(1) // non duplicato
  })

  it('non aggiunge token ≤ 3 caratteri', () => {
    const text = 'Luca De Rosa ha firmato. Luca ha confermato. De ha detto. Rosa ha detto.'
    const entities = [makePersona('Luca De Rosa')]
    const expanded = expandCoReferences(entities, text)
    // "De" (2 char) e "Luca" (4 char, > 3) → "Luca" può essere aggiunto se ≥ 2 occ.
    // "De" deve essere escluso (≤ 3 chars)
    expect(expanded.find(e => e.originalText === 'De')).toBeUndefined()
  })

  it('non applica co-reference a entità ORGANIZZAZIONE', () => {
    const text = 'Studio Legale Rossi ha presentato. Rossi ha confermato. Rossi era presente.'
    const entities = [{
      id: 'test',
      type: 'ORGANIZZAZIONE' as const,
      originalText: 'Studio Legale Rossi',
      pseudonym: 'S. L. R.',
      occurrences: 1,
      confirmed: true,
      source: 'ner' as const,
    }]
    const expanded = expandCoReferences(entities, text)
    // Nessuna co-reference su ORGANIZZAZIONE
    expect(expanded).toHaveLength(1)
  })

  it('non applica co-reference a entità con source regex', () => {
    const text = 'Mario Rossi ha firmato. Rossi ha confermato. Rossi era presente.'
    const entities = [makePersona('Mario Rossi', 'regex')]
    const expanded = expandCoReferences(entities, text)
    // source !== 'ner' → nessuna co-reference
    expect(expanded).toHaveLength(1)
  })

  it('filtra stop words legali dai token co-referenziali', () => {
    // "Presidente Rossi" → token "Presidente" (in LEGAL_STOP_WORDS), "Rossi" (non in stop list)
    const text = 'Presidente Rossi ha firmato. Rossi ha confermato. Rossi era presente.'
    const entities = [makePersona('Presidente Rossi')]
    const expanded = expandCoReferences(entities, text)
    // "Presidente" è in LEGAL_STOP_WORDS → non aggiunto
    expect(expanded.find(e => e.originalText === 'Presidente')).toBeUndefined()
    // "Rossi" → può essere aggiunto
    expect(expanded.find(e => e.originalText === 'Rossi')).toBeDefined()
  })

  it('non modifica il numero di entità se nessun token supera la soglia', () => {
    const text = 'Mario Rossi è il ricorrente.'
    const entities = [makePersona('Mario Rossi')]
    const expanded = expandCoReferences(entities, text)
    expect(expanded).toHaveLength(1)
  })

  it('entità padre con un solo token non genera co-references', () => {
    const text = 'Rossi ha firmato. Rossi ha confermato. Rossi era presente.'
    const entities = [makePersona('Rossi')] // 1 solo token
    const expanded = expandCoReferences(entities, text)
    expect(expanded).toHaveLength(1)
  })
})
