import { describe, it, expect } from 'vitest'

// Testa i pattern regex direttamente — senza caricare il modello NER
// (il modello BERT richiede un file ~400MB non presente in CI)

const PATTERNS = {
  CODICE_FISCALE: /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi,
  PARTITA_IVA: /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi,
  IBAN: /\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi,
  EMAIL: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi,
  TELEFONO: /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g
}

function match(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0
  return [...text.matchAll(pattern)].map(m => (m[1] ?? m[0]).trim())
}

describe('Regex CODICE_FISCALE', () => {
  it('riconosce CF valido', () => {
    expect(match(PATTERNS.CODICE_FISCALE, 'il sig. RSSMRA80A01H501U è nato a Roma')).toContain('RSSMRA80A01H501U')
  })
  it('non riconosce sequenze troppo corte', () => {
    expect(match(PATTERNS.CODICE_FISCALE, 'ABC123')).toHaveLength(0)
  })
})

describe('Regex PARTITA_IVA', () => {
  it('riconosce P.IVA con prefisso', () => {
    const m = match(PATTERNS.PARTITA_IVA, 'P.IVA: 12345678901')
    expect(m).toContain('12345678901')
  })
  it('riconosce 11 cifre bare', () => {
    expect(match(PATTERNS.PARTITA_IVA, 'codice 12345678901 contribuente')).toContain('12345678901')
  })
})

describe('Regex IBAN', () => {
  it('riconosce IBAN italiano', () => {
    expect(match(PATTERNS.IBAN, 'IBAN: IT60X0542811101000000123456')).toContain('IT60X0542811101000000123456')
  })
  it('non riconosce IBAN straniero', () => {
    expect(match(PATTERNS.IBAN, 'DE89370400440532013000')).toHaveLength(0)
  })
})

describe('Regex EMAIL', () => {
  it('riconosce email standard', () => {
    expect(match(PATTERNS.EMAIL, 'contattare mario.rossi@studio-legale.it per info')).toContain('mario.rossi@studio-legale.it')
  })
})

describe('Regex TELEFONO', () => {
  it('riconosce cellulare italiano', () => {
    expect(match(PATTERNS.TELEFONO, 'tel. 333 1234567')).toHaveLength(1)
  })
  it('riconosce fisso con prefisso', () => {
    expect(match(PATTERNS.TELEFONO, 'ufficio: 06 12345678')).toHaveLength(1)
  })
  it('riconosce +39', () => {
    expect(match(PATTERNS.TELEFONO, '+39 347 1234567')).toHaveLength(1)
  })
})
