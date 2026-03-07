import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager } from '../src/main/services/sessionManager'

describe('SessionManager', () => {
  let sm: SessionManager

  beforeEach(() => {
    sm = new SessionManager()
  })

  it('assegna pseudonimo unico a nuova entità', () => {
    const p = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    expect(p).toBe('M. R.')
  })

  it('riusa lo stesso pseudonimo per la stessa stringa', () => {
    const p1 = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    const p2 = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    expect(p1).toBe(p2)
  })

  it('il matching è case-insensitive', () => {
    const p1 = sm.getOrCreatePseudonym('mario rossi', 'PERSONA')
    const p2 = sm.getOrCreatePseudonym('MARIO ROSSI', 'PERSONA')
    expect(p1).toBe(p2)
  })

  it('entità diverse ricevono pseudonimi diversi', () => {
    const p1 = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    const p2 = sm.getOrCreatePseudonym('Lucia Bianchi', 'PERSONA')
    expect(p1).not.toBe(p2)
    expect(p1).toBe('M. R.')
    expect(p2).toBe('L. B.')
  })

  it('tipi diversi hanno pseudonimi distinti', () => {
    const persona = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    const org = sm.getOrCreatePseudonym('Acme SRL', 'ORGANIZZAZIONE')
    const iban = sm.getOrCreatePseudonym('IT60X0542811101000000123456', 'IBAN')
    // Persone e org → iniziali; dati strutturati → prefisso numerico
    expect(persona).toBe('M. R.')
    expect(org).toBe('A. S.')
    expect(iban).toMatch(/^IBAN_/)
  })

  it('reset svuota il dizionario', () => {
    sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    sm.reset()
    const p = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    expect(p).toBe('M. R.') // dopo reset, riassegna le stesse iniziali
  })

  it('getDictionaryStats restituisce conteggi corretti', () => {
    sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    sm.getOrCreatePseudonym('Lucia Bianchi', 'PERSONA')
    sm.getOrCreatePseudonym('Acme SRL', 'ORGANIZZAZIONE')
    const stats = sm.getDictionaryStats()
    expect(stats.totalEntries).toBe(3)
    // byType conta solo le entità con fallback numerico (no initials); qui tutte usano iniziali
    expect(stats.byType['IBAN']).toBeUndefined()
  })
})
