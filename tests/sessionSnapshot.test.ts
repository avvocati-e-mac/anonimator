import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager } from '../src/main/services/sessionManager'

describe('SessionManager — snapshot/restore', () => {
  let sm: SessionManager

  beforeEach(() => {
    sm = new SessionManager()
  })

  it('annulla una passata OCR scartata: stesso soggetto riottiene le stesse iniziali, senza disambiguazione spuria', () => {
    // Caso concreto documentato: primo OCR (layer rotto) legge "Mario Ross1" e
    // occupa le iniziali "M. R.". Senza snapshot/restore, il secondo OCR (corretto)
    // troverebbe "M. R." già occupato e finirebbe disambiguato a "M. R. (2)".
    const snap = sm.snapshot()

    sm.getOrCreatePseudonym('Mario Ross1', 'PERSONA')
    expect(sm.getDictionaryStats().totalEntries).toBe(1)

    sm.restore(snap)
    expect(sm.getDictionaryStats().totalEntries).toBe(0)

    const pseudonym = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    expect(pseudonym).toBe('M. R.')
    expect(pseudonym).not.toBe('M. R. (2)')
  })

  it('ripristina lo stato precedente preservando le voci registrate prima dello snapshot', () => {
    sm.getOrCreatePseudonym('Lucia Bianchi', 'PERSONA')
    const snap = sm.snapshot()

    sm.getOrCreatePseudonym('Marco Verdi', 'PERSONA')
    expect(sm.getDictionaryStats().totalEntries).toBe(2)

    sm.restore(snap)
    expect(sm.getDictionaryStats().totalEntries).toBe(1)
    // La voce precedente allo snapshot resta coerente (stesso pseudonimo)
    expect(sm.getOrCreatePseudonym('Lucia Bianchi', 'PERSONA')).toBe('L. B.')
  })

  it('lo snapshot è una copia profonda: modificare il dizionario dopo non altera lo snapshot già preso', () => {
    sm.getOrCreatePseudonym('Anna Neri', 'PERSONA')
    const snap = sm.snapshot()

    // Registra altre voci e un contatore strutturato dopo lo snapshot
    sm.getOrCreatePseudonym('IT60X0542811101000000123456', 'IBAN')
    sm.getOrCreatePseudonym('Bruno Gialli', 'PERSONA')

    sm.restore(snap)
    const stats = sm.getDictionaryStats()
    expect(stats.totalEntries).toBe(1)
    expect(stats.byType['IBAN']).toBeUndefined()
  })

  it('ripristina anche i contatori numerici (entità strutturate)', () => {
    sm.getOrCreatePseudonym('IT60X0542811101000000123456', 'IBAN')
    const snap = sm.snapshot()

    sm.getOrCreatePseudonym('IT11Y1234567890123456789012', 'IBAN')
    expect(sm.getDictionaryStats().byType['IBAN']).toBe(2)

    sm.restore(snap)
    expect(sm.getDictionaryStats().byType['IBAN']).toBe(1)

    // Il prossimo IBAN dopo il restore riprende dal contatore corretto (002, non 003)
    const nextPseudonym = sm.getOrCreatePseudonym('IT99Z9999999999999999999999', 'IBAN')
    expect(nextPseudonym).toBe('IBAN_002')
  })
})
