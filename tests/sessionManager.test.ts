import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager } from '../src/main/services/sessionManager'

describe('SessionManager', () => {
  let sm: SessionManager

  beforeEach(() => {
    sm = new SessionManager()
  })

  it('assegna pseudonimo unico a nuova entità', () => {
    const p = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    expect(p).toBe('SOGGETTO_001')
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
    expect(p1).toBe('SOGGETTO_001')
    expect(p2).toBe('SOGGETTO_002')
  })

  it('tipi diversi hanno prefissi diversi', () => {
    const persona = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    const org = sm.getOrCreatePseudonym('Acme SRL', 'ORGANIZZAZIONE')
    const iban = sm.getOrCreatePseudonym('IT60X0542811101000000123456', 'IBAN')
    expect(persona).toMatch(/^SOGGETTO_/)
    expect(org).toMatch(/^ENTE_/)
    expect(iban).toMatch(/^IBAN_/)
  })

  it('reset svuota il dizionario', () => {
    sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    sm.reset()
    const p = sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    expect(p).toBe('SOGGETTO_001') // riparte da 001
  })

  it('getDictionaryStats restituisce conteggi corretti', () => {
    sm.getOrCreatePseudonym('Mario Rossi', 'PERSONA')
    sm.getOrCreatePseudonym('Lucia Bianchi', 'PERSONA')
    sm.getOrCreatePseudonym('Acme SRL', 'ORGANIZZAZIONE')
    const stats = sm.getDictionaryStats()
    expect(stats.totalEntries).toBe(3)
    expect(stats.byType['PERSONA']).toBe(2)
    expect(stats.byType['ORGANIZZAZIONE']).toBe(1)
  })
})
