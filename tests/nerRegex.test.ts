import { describe, it, expect } from 'vitest'
import {
  CODICE_FISCALE_PATTERN_LENIENT,
  CODICE_FISCALE_PATTERN_STRICT,
  PARTITA_IVA_PATTERN,
  IBAN_PATTERN,
  EMAIL_PATTERN,
  TELEFONO_PATTERN,
  PROCESSO_PARTE_PATTERN,
  DIFENSORE_PATTERN,
  ALLCAPS_NAME_PATTERN,
  DATA_NASCITA_PATTERN,
  LUOGO_NASCITA_PATTERN,
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
  it('riconosce CF con lettera mese invalida nella posizione 9 (pattern lenient)', () => {
    // RSSMRA80Q01H501U — posizione 9 (mese) = Q, invalida, ma lenient lo accetta
    expect(match(CODICE_FISCALE_PATTERN_LENIENT, 'RSSMRA80Q01H501U')).toContain('RSSMRA80Q01H501U')
  })
})

// Helper per testare entrambi i pattern CF
function matchesCF(cf: string, strict: boolean): boolean {
  const pattern = strict ? CODICE_FISCALE_PATTERN_STRICT : CODICE_FISCALE_PATTERN_LENIENT
  pattern.lastIndex = 0
  return pattern.test(cf)
}

describe('Regex CODICE_FISCALE strict vs lenient', () => {
  it('CF valido matcha con entrambi i pattern', () => {
    expect(matchesCF('RSSMRA80A01H501U', false)).toBe(true)
    expect(matchesCF('RSSMRA80A01H501U', true)).toBe(true)
  })
  it('CF con lettera mese invalida (Q): lenient lo accetta, strict lo rifiuta', () => {
    // Struttura CF: COGNOME(6) NOME(3) ANNO(2) MESE(1) GIORNO(2) COMUNE(4) CHECK(1)
    // RSSMRA80Q01H501U — posizione 9 (mese) = Q, lettera invalida
    expect(matchesCF('RSSMRA80Q01H501U', false)).toBe(true)
    expect(matchesCF('RSSMRA80Q01H501U', true)).toBe(false)
  })
  it('CF con giorno 99 (invalido): lenient lo accetta, strict lo rifiuta', () => {
    // RSSMRA80A99H501U — giorno "99" non è valido (max 71)
    expect(matchesCF('RSSMRA80A99H501U', false)).toBe(true)
    expect(matchesCF('RSSMRA80A99H501U', true)).toBe(false)
  })
  it('CF con giorno 71 (max valido per donna): strict lo accetta', () => {
    // RSSMRA80A71H501U — giorno "71" è il massimo valido
    expect(matchesCF('RSSMRA80A71H501U', true)).toBe(true)
  })
  it('CF con giorno 00 (invalido): strict lo rifiuta', () => {
    expect(matchesCF('RSSMRA80A00H501U', true)).toBe(false)
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

// ─── Fix sessione 047 — entità mancanti contratto di locazione ───────────────

describe('Pattern B1 fix — DATA_NASCITA (date letterali italiane)', () => {
  it('cattura data letterale dopo "nato a Napoli il"', () => {
    const m = match(DATA_NASCITA_PATTERN, 'nato a Napoli il 23 luglio 1968')
    expect(m.some(v => v === '23 luglio 1968')).toBe(true)
  })
  it('cattura data letterale dopo "nata a Salerno il"', () => {
    const m = match(DATA_NASCITA_PATTERN, 'nata a Salerno il 12 gennaio 1985')
    expect(m.some(v => v === '12 gennaio 1985')).toBe(true)
  })
  it('cattura data letterale dopo "nato a Milano il" (mese agosto)', () => {
    const m = match(DATA_NASCITA_PATTERN, 'nato a Milano il 07 agosto 1971')
    expect(m.some(v => v === '07 agosto 1971')).toBe(true)
  })
  it('NON cattura data letterale senza contesto nascita', () => {
    const m = match(DATA_NASCITA_PATTERN, 'udienza del 15 marzo 2024')
    expect(m).toHaveLength(0)
  })
  it('continua a catturare date numeriche (regressione)', () => {
    const m = match(DATA_NASCITA_PATTERN, 'nato il 15/03/1978')
    expect(m.some(v => v === '15/03/1978')).toBe(true)
  })
})

describe('Pattern B0 — LUOGO_NASCITA', () => {
  it('cattura città dopo "nato a ... il"', () => {
    const m = match(LUOGO_NASCITA_PATTERN, 'nato a Napoli il 23 luglio 1968')
    expect(m).toContain('Napoli')
  })
  it('cattura città dopo "nata a ... il"', () => {
    const m = match(LUOGO_NASCITA_PATTERN, 'nata a Salerno il 12 gennaio 1985')
    expect(m).toContain('Salerno')
  })
  it('cattura città composta (Reggio Calabria)', () => {
    const m = match(LUOGO_NASCITA_PATTERN, 'nato a Reggio Calabria il 05/06/1990')
    expect(m.some(v => v.trim() === 'Reggio Calabria')).toBe(true)
  })
  it('NON cattura città in contesto generico senza "il" finale', () => {
    const m = match(LUOGO_NASCITA_PATTERN, "la Corte d'Appello di Napoli ha deciso")
    expect(m).toHaveLength(0)
  })
  it('NON cattura senza "il" data seguente (solo "nato a Napoli, residente")', () => {
    const m = match(LUOGO_NASCITA_PATTERN, 'nato a Napoli, residente a Roma')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B2 fix — INDIRIZZO (CAP flessibile e keyword estese)', () => {
  it('cattura Via con CAP dopo trattino "Via Roma, 112 - 10121 Torino"', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'residente in Via Roma, 112 - 10121 Torino')
    expect(m).toHaveLength(1)
  })
  it('cattura Viale con "residente attualmente" e CAP dopo trattino', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'residente attualmente in Viale Piemonte, 34 - 10138 Torino')
    expect(m).toHaveLength(1)
  })
  it('cattura Corso con keyword "sito in"', () => {
    const m = match(INDIRIZZO_PATTERN_CORSO, 'sito in Corso Buenos Aires, 15 10129 Torino')
    expect(m).toHaveLength(1)
  })
  it('continua a catturare Via con CAP alla fine senza trattino (regressione)', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'residente in Via Roma 15, 00100')
    expect(m).toHaveLength(1)
  })
  it('continua a NON catturare Via senza CAP (regressione)', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'residente in Via Roma 15')
    expect(m).toHaveLength(0)
  })
  it('NON cattura "sito" senza CAP (falso positivo)', () => {
    const m = match(INDIRIZZO_PATTERN_STANDARD, 'sito internet Via Roma')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B3 fix — NUMERO_DOCUMENTO (spazio nel codice)', () => {
  it('cattura numero C.I. con spazio "CA 5528847"', () => {
    const m = match(NUMERO_DOCUMENTO_PATTERN, "Carta d'identità n. CA 5528847")
    expect(m.some(v => v.replace(/\s/, '') === 'CA5528847' || v === 'CA 5528847')).toBe(true)
  })
  it('continua a catturare numero C.I. senza spazio (regressione)', () => {
    const m = match(NUMERO_DOCUMENTO_PATTERN, "carta d'identità n. AB1234567")
    expect(m.some(v => v === 'AB1234567')).toBe(true)
  })
  it('continua a catturare passaporto senza spazio (regressione)', () => {
    const m = match(NUMERO_DOCUMENTO_PATTERN, 'passaporto: YA9876543')
    expect(m.some(v => v === 'YA9876543')).toBe(true)
  })
})
