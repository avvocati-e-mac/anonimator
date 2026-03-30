import { describe, it, expect } from 'vitest'
import { applyContextualBoost } from '../src/main/services/nerService'
import type { DetectedEntity } from '../src/shared/types'

function makeBertLow(text: string, type: DetectedEntity['type'] = 'PERSONA'): DetectedEntity {
  return {
    id: `bert_${text}`,
    type,
    originalText: text,
    pseudonym: '',
    occurrences: 1,
    confirmed: true,
    source: 'ner',
  }
}

function makeRegexCtx(text: string, type: DetectedEntity['type'] = 'PERSONA'): DetectedEntity {
  return {
    id: `regex_${text}`,
    type,
    originalText: text,
    pseudonym: '',
    occurrences: 1,
    confirmed: true,
    source: 'regex',
  }
}

describe('applyContextualBoost', () => {
  it('promuove entità BERT sotto soglia confermata da regex contestuale', () => {
    const bertLow = [makeBertLow('Anna Bianchi')]
    const regexCtx = [makeRegexCtx('Anna Bianchi')]
    const boosted = applyContextualBoost(bertLow, regexCtx)
    expect(boosted).toHaveLength(1)
    expect(boosted[0].source).toBe('boosted')
    expect(boosted[0].originalText).toBe('Anna Bianchi')
  })

  it('non promuove entità senza conferma regex', () => {
    const bertLow = [makeBertLow('Mario Ferrari')]
    const regexCtx = [makeRegexCtx('Anna Bianchi')]
    const boosted = applyContextualBoost(bertLow, regexCtx)
    expect(boosted).toHaveLength(0)
  })

  it('confronto case-insensitive', () => {
    const bertLow = [makeBertLow('anna bianchi')]
    const regexCtx = [makeRegexCtx('Anna Bianchi')]
    const boosted = applyContextualBoost(bertLow, regexCtx)
    expect(boosted).toHaveLength(1)
  })

  it('non fa da booster entità regex strutturate (CF, IBAN, EMAIL)', () => {
    const bertLow = [makeBertLow('12345678901', 'PARTITA_IVA')]
    const regexCtx = [makeRegexCtx('12345678901', 'PARTITA_IVA')]
    const boosted = applyContextualBoost(bertLow, regexCtx)
    // PARTITA_IVA non è in nerLikeTypes (PERSONA/ORG/LOC) → non fa da booster
    expect(boosted).toHaveLength(0)
  })

  it('entità regex ORGANIZZAZIONE può fare da booster per BERT sotto soglia ORG', () => {
    const bertLow = [makeBertLow('Studio Legale Ferrari', 'ORGANIZZAZIONE')]
    const regexCtx = [makeRegexCtx('Studio Legale Ferrari', 'ORGANIZZAZIONE')]
    const boosted = applyContextualBoost(bertLow, regexCtx)
    expect(boosted).toHaveLength(1)
    expect(boosted[0].source).toBe('boosted')
  })

  it('array vuoto se nessun candidato sotto soglia', () => {
    const boosted = applyContextualBoost([], [makeRegexCtx('Anna Bianchi')])
    expect(boosted).toHaveLength(0)
  })

  it('array vuoto se nessuna entità regex contestuale', () => {
    const boosted = applyContextualBoost([makeBertLow('Anna Bianchi')], [])
    expect(boosted).toHaveLength(0)
  })
})
