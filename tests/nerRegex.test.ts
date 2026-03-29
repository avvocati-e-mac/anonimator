import { describe, it, expect } from 'vitest'
import {
  CODICE_FISCALE_PATTERN_LENIENT,
  PARTITA_IVA_PATTERN,
  IBAN_PATTERN,
  EMAIL_PATTERN,
  TELEFONO_PATTERN,
  PROCESSO_PARTE_PATTERN,
  DIFENSORE_PATTERN,
  ALLCAPS_NAME_PATTERN,
  DATA_NASCITA_PATTERN,
  INDIRIZZO_PATTERN_STANDARD,
  INDIRIZZO_PATTERN_CORSO,
  NUMERO_DOCUMENTO_PATTERN,
  POLIZZA_PARTE_PATTERN,
  CONTRATTO_PARTE_PATTERN,
  PERIZIA_SOGGETTO_PATTERN,
  AVV_LISTA_PATTERN,
  PKI_FIRMA_PATTERN,
} from '../src/main/services/regexPatterns'

// Testa i pattern regex direttamente — senza caricare il modello NER
// (il modello BERT richiede un file ~400MB non presente in CI)

function match(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0
  // Usa il primo gruppo di cattura non-undefined; fallback su m[0]
  return [...text.matchAll(pattern)].map(m => {
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) return m[i].trim()
    }
    return m[0].trim()
  })
}

describe('Regex CODICE_FISCALE (lenient)', () => {
  it('riconosce CF valido', () => {
    expect(match(CODICE_FISCALE_PATTERN_LENIENT, 'il sig. RSSMRA80A01H501U è nato a Roma')).toContain('RSSMRA80A01H501U')
  })
  it('non riconosce sequenze troppo corte', () => {
    expect(match(CODICE_FISCALE_PATTERN_LENIENT, 'ABC123')).toHaveLength(0)
  })
  it('riconosce CF con lettera mese invalida (pattern lenient)', () => {
    // 'Q' non è una lettera di mese valida, ma il pattern lenient lo accetta
    expect(match(CODICE_FISCALE_PATTERN_LENIENT, 'RSSMRQ80A01H501U')).toContain('RSSMRQ80A01H501U')
  })
})

describe('Regex PARTITA_IVA', () => {
  it('riconosce P.IVA con prefisso', () => {
    const m = match(PARTITA_IVA_PATTERN, 'P.IVA: 12345678901')
    expect(m).toContain('12345678901')
  })
  it('riconosce 11 cifre bare', () => {
    expect(match(PARTITA_IVA_PATTERN, 'codice 12345678901 contribuente')).toContain('12345678901')
  })
})

describe('Regex IBAN', () => {
  it('riconosce IBAN italiano', () => {
    expect(match(IBAN_PATTERN, 'IBAN: IT60X0542811101000000123456')).toContain('IT60X0542811101000000123456')
  })
  it('non riconosce IBAN straniero', () => {
    expect(match(IBAN_PATTERN, 'DE89370400440532013000')).toHaveLength(0)
  })
})

describe('Regex EMAIL', () => {
  it('riconosce email standard', () => {
    expect(match(EMAIL_PATTERN, 'contattare mario.rossi@studio-legale.it per info')).toContain('mario.rossi@studio-legale.it')
  })
})

describe('Regex TELEFONO', () => {
  it('riconosce cellulare italiano', () => {
    expect(match(TELEFONO_PATTERN, 'tel. 333 1234567')).toHaveLength(1)
  })
  it('riconosce fisso con prefisso', () => {
    expect(match(TELEFONO_PATTERN, 'ufficio: 06 12345678')).toHaveLength(1)
  })
  it('riconosce +39', () => {
    expect(match(TELEFONO_PATTERN, '+39 347 1234567')).toHaveLength(1)
  })
})

// ─── Nuovi pattern strutturati legali ────────────────────────────────────────

describe('Pattern A1 — PROCESSO_PARTE', () => {
  it('cattura nome dopo "ricorrente:"', () => {
    const m = match(PROCESSO_PARTE_PATTERN, '\nricorrente: Lasagni Barbara')
    expect(m).toContain('Lasagni Barbara')
  })
  it('cattura nome dopo "appellante,"', () => {
    const m = match(PROCESSO_PARTE_PATTERN, '\nappellante, Mario Rossi')
    expect(m).toContain('Mario Rossi')
  })
  it('non cattura parole singole', () => {
    const m = match(PROCESSO_PARTE_PATTERN, '\nricorrente: Mario')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern A2 — DIFENSORE', () => {
  it("cattura nome dopo \"difesa dall'avv.\"", () => {
    const m = match(DIFENSORE_PATTERN, "difesa dall'avv. Giovanni Ferrari")
    expect(m).toContain('Giovanni Ferrari')
  })
  it('cattura nome dopo "assistito avvocato"', () => {
    const m = match(DIFENSORE_PATTERN, 'assistito avvocato Carla Bianchi')
    expect(m).toContain('Carla Bianchi')
  })
  it('non cattura senza keyword difensore', () => {
    const m = match(DIFENSORE_PATTERN, 'avv. Giovanni Ferrari')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern A3 — ALLCAPS_NAME (tutto maiuscolo su riga)', () => {
  it('cattura nome tutto-maiuscolo su riga propria', () => {
    const m = match(ALLCAPS_NAME_PATTERN, '\nLASAGNI BARBARA\n')
    expect(m).toContain('LASAGNI BARBARA')
  })
  it('cattura nome tutto-maiuscolo seguito da trattino', () => {
    const m = match(ALLCAPS_NAME_PATTERN, '\nROSSI MARIO -\n')
    expect(m).toContain('ROSSI MARIO')
  })
  it('non cattura singole parole maiuscole', () => {
    // Solo 1 token: deve avere 2-3 token per essere un nome
    const m = match(ALLCAPS_NAME_PATTERN, '\nROSSI\n')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B1 — DATA_NASCITA', () => {
  it('cattura data dopo "nato il"', () => {
    const m = match(DATA_NASCITA_PATTERN, 'nato il 15/03/1978 a Roma')
    expect(m.some(v => v === '15/03/1978')).toBe(true)
  })
  it('cattura data dopo "Data di nascita:"', () => {
    const m = match(DATA_NASCITA_PATTERN, 'Data di nascita: 15.03.1978')
    expect(m.some(v => v === '15.03.1978')).toBe(true)
  })
  it('non cattura testo senza contesto data-nascita', () => {
    const m = match(DATA_NASCITA_PATTERN, 'il documento del 15/03/1978')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B2 — INDIRIZZO_STANDARD (Via/Viale/Piazza/ecc.)', () => {
  it('cattura indirizzo con CAP dopo "residente in"', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'residente in Via Roma 15, 00100')
    expect(m).toHaveLength(1)
  })
  it('cattura indirizzo con Piazza', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'domiciliato in Piazza Garibaldi 3, 20100')
    expect(m).toHaveLength(1)
  })
  it('non cattura indirizzo senza CAP', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'residente in Via Roma 15')
    expect(m).toHaveLength(0)
  })
  it('non cattura Corso (delegato a INDIRIZZO_PATTERN_CORSO)', () => {
    // INDIRIZZO_PATTERN_STANDARD non include "Corso" — evita falsi positivi
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'nel corso di indagini, residente in Via Roma 15, 00100')
    // Deve trovare Via Roma ma non "corso di indagini"
    expect(m).toHaveLength(1)
  })
})

describe('Pattern B2b — INDIRIZZO_CORSO', () => {
  it('cattura "Corso Roma 15" come indirizzo dopo "residente in"', () => {
    const m = match(INDIRIZZO_PATTERN_CORSO, 'residente in Corso Roma 15, 00100')
    expect(m).toHaveLength(1)
  })
  it('NON cattura "corso di indagini" senza contesto residenza', () => {
    const m = match(INDIRIZZO_PATTERN_CORSO, 'nel corso di indagini')
    expect(m).toHaveLength(0)
  })
  it('NON cattura "corso di istruzione"', () => {
    const m = match(INDIRIZZO_PATTERN_CORSO, 'corso di istruzione')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B3 — NUMERO_DOCUMENTO', () => {
  it("cattura numero carta d'identità", () => {
    const m = match(NUMERO_DOCUMENTO_PATTERN, "carta d'identità n. AB1234567")
    expect(m.some(v => v === 'AB1234567')).toBe(true)
  })
  it('cattura numero passaporto', () => {
    const m = match(NUMERO_DOCUMENTO_PATTERN, 'passaporto: YA9876543')
    expect(m.some(v => v === 'YA9876543')).toBe(true)
  })
  it('non cattura sequenze senza contesto documento', () => {
    const m = match(NUMERO_DOCUMENTO_PATTERN, 'codice AB1234567')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern C1 — POLIZZA_PARTE', () => {
  it('cattura nome dopo "Contraente:"', () => {
    const m = match(POLIZZA_PARTE_PATTERN, 'Contraente: Mario Rossi')
    expect(m).toContain('Mario Rossi')
  })
  it('cattura nome dopo "Assicurato:"', () => {
    const m = match(POLIZZA_PARTE_PATTERN, 'Assicurato: Carla Ferrari')
    expect(m).toContain('Carla Ferrari')
  })
})

describe('Pattern C2 — CONTRATTO_PARTE', () => {
  it('cattura nome in formula contrattuale "tra X, nato"', () => {
    const m = match(CONTRATTO_PARTE_PATTERN, 'tra Mario Rossi, nato il 1980')
    expect(m).toContain('Mario Rossi')
  })
  it('cattura nome in formula "fra X, residente"', () => {
    const m = match(CONTRATTO_PARTE_PATTERN, 'fra Luca Bianchi, residente a Milano')
    expect(m).toContain('Luca Bianchi')
  })
  it('non cattura se manca la keyword post-virgola', () => {
    const m = match(CONTRATTO_PARTE_PATTERN, 'tra Mario Rossi, un avvocato')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern C3 — PERIZIA_SOGGETTO', () => {
  it('cattura nome dopo "Paziente:"', () => {
    const m = match(PERIZIA_SOGGETTO_PATTERN, 'Paziente: Giuseppe Verdi')
    expect(m).toContain('Giuseppe Verdi')
  })
  it('cattura nome dopo "CTU:"', () => {
    const m = match(PERIZIA_SOGGETTO_PATTERN, 'CTU: Anna Maria Conti')
    expect(m).toContain('Anna Maria Conti')
  })
})

// ─── Blocco D: avvocati in lista e firma PKI ─────────────────────────────────

/** Estrae nomi multipli da un blocco AVV_LISTA (split su virgola) */
function matchAvvLista(text: string): string[] {
  const p = AVV_LISTA_PATTERN
  p.lastIndex = 0
  const results: string[] = []
  for (const m of text.matchAll(p)) {
    const block = m[1].trim()
    const names = block.split(/\s*,\s*/).map(s => s.trim()).filter(s => s.length > 2)
    results.push(...names)
  }
  return results
}

describe('Pattern D1 — AVV_LISTA (avvocati in lista)', () => {
  it('cattura due avvocati dalla sentenza reale', () => {
    const names = matchAvvLista('rappresentato e difeso dagli avvocati VINCENZO LIGUORI, MICHELE LIGUORI;')
    expect(names).toContain('VINCENZO LIGUORI')
    expect(names).toContain('MICHELE LIGUORI')
  })
  it('cattura avvocato singolo', () => {
    const names = matchAvvLista('difeso dall\'avvocato Mario Ferrari')
    expect(names).toContain('Mario Ferrari')
  })
  it('cattura tre avvocati', () => {
    const names = matchAvvLista('avvocati Mario Rossi, Luigi Bianchi, Anna Verdi')
    expect(names).toHaveLength(3)
    expect(names).toContain('Anna Verdi')
  })
  it('non cattura senza keyword avvocati', () => {
    const names = matchAvvLista('VINCENZO LIGUORI, MICHELE LIGUORI')
    expect(names).toHaveLength(0)
  })
})

describe('Pattern D2 — PKI_FIRMA (firma digitale)', () => {
  it('cattura firmatari da riga PKI reale', () => {
    const text = 'Firmato Da: PASSINETTI LUISA Emesso Da: ARUBAPEC S.P.A. NG CA 3 - Firmato Da: BERTUZZI MARIO Emesso Da: ARUBAPEC'
    const m = match(PKI_FIRMA_PATTERN, text)
    expect(m).toContain('PASSINETTI LUISA')
    expect(m).toContain('BERTUZZI MARIO')
  })
  it('cattura singolo firmatario', () => {
    const m = match(PKI_FIRMA_PATTERN, 'Firmato Da: ROSSI MARIO Emesso Da: CA CERT')
    expect(m).toContain('ROSSI MARIO')
  })
  it('non cattura senza keyword "Emesso"', () => {
    const m = match(PKI_FIRMA_PATTERN, 'Firmato Da: ROSSI MARIO')
    expect(m).toHaveLength(0)
  })
})
