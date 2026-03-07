import { describe, it, expect } from 'vitest'

// Testa i pattern regex direttamente — senza caricare il modello NER
// (il modello BERT richiede un file ~400MB non presente in CI)

const PATTERNS = {
  CODICE_FISCALE: /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi,
  PARTITA_IVA: /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi,
  IBAN: /\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi,
  EMAIL: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi,
  TELEFONO: /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g,
  // Nuovi pattern strutturati legali
  PROCESSO_PARTE: new RegExp(
    '(?:^|\\n)\\s*(?:ricorrente|resistente|appellante|appellato|intimato|' +
    'controricorrente|opponente|opposto|attore|convenuto|debitore|creditore|' +
    'fallito|fallendo|istante|intervenuto)[:\\s,]+' +
    "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})",
    'gi'
  ),
  DIFENSORE: new RegExp(
    '(?:difeso|difesa|rappresentato|rappresentata|assistito|assistita)\\s+' +
    "(?:dall?['\\u2019])?(?:avv\\.?|avvocato|procuratore)\\s+" +
    "([A-Z][A-Za-z\u00C0-\u00FF']+(?:\\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})",
    'gi'
  ),
  ALLCAPS_NAME: new RegExp(
    '(?:^|\\n)([A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC\']{1,25}' +
    '(?:\\s+[A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC]{1,25}){1,2})' +
    '(?:\\s*$|\\s*[+]|\\s*[-\u2013]\\s*(?:$|\\n))',
    'gm'
  ),
  DATA_NASCITA: /(?:nato|nata|n\.)[\s,]+(?:a\s+\S+\s+)?il\s+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})|(?:data(?:\s+di)?\s+nascita|d\.d\.n\.)[:\s]+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi,
  INDIRIZZO: /(?:residente|domiciliato|domiciliata|con\s+sede)\s+(?:in\s+)?(?:Via|Viale|Corso|Piazza|Largo|Vicolo|Str\.|Loc\.|Fraz\.|V\.le)\s+[A-Za-z\u00C0-\u00FF\s0-9,.']{3,50},?\s*\d{5}/gi,
  NUMERO_DOCUMENTO: /(?:carta(?:\s+d[i']\s*identit[àa])?|passaporto|patente|C\.I\.E?\.?)[\s:,n.°]+([A-Z]{2}[0-9]{5,7}[A-Z]?)|(?:n(?:umero)?\.?\s*doc(?:umento)?[:\s]+)([A-Z]{2}[0-9]{5,7}[A-Z]?)/gi,
  POLIZZA_PARTE: /(?:Contraente|Assicurato|Assicurata|Beneficiario|Intestatario)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi,
  CONTRATTO_PARTE: /(?:tra|fra)\s+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}),\s+(?:nato|nata|residente|domiciliato|codice\s+fiscale|con\s+sede)/gi,
  PERIZIA_SOGGETTO: /(?:Paziente|CTU|C\.T\.U\.|CTP|C\.T\.P\.|Perito|Esaminato|Esaminata)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi,
  // Blocco D
  AVV_LISTA: /avvocat[oi]\s+((?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})(?:\s*,\s*(?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}))*)/gi,
  PKI_FIRMA: /Firmato\s+Da:\s+([A-Z][A-Z\u00C0-\u00DC]+\s+[A-Z][A-Z\u00C0-\u00DC]+)\s+Emesso/gi,
}

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

// ─── Nuovi pattern strutturati legali ────────────────────────────────────────

describe('Pattern A1 — PROCESSO_PARTE', () => {
  it('cattura nome dopo "ricorrente:"', () => {
    const m = match(PATTERNS.PROCESSO_PARTE, '\nricorrente: Lasagni Barbara')
    expect(m).toContain('Lasagni Barbara')
  })
  it('cattura nome dopo "appellante,"', () => {
    const m = match(PATTERNS.PROCESSO_PARTE, '\nappellante, Mario Rossi')
    expect(m).toContain('Mario Rossi')
  })
  it('non cattura parole singole', () => {
    const m = match(PATTERNS.PROCESSO_PARTE, '\nricorrente: Mario')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern A2 — DIFENSORE', () => {
  it("cattura nome dopo \"difesa dall'avv.\"", () => {
    const m = match(PATTERNS.DIFENSORE, "difesa dall'avv. Giovanni Ferrari")
    expect(m).toContain('Giovanni Ferrari')
  })
  it('cattura nome dopo "assistito avvocato"', () => {
    const m = match(PATTERNS.DIFENSORE, 'assistito avvocato Carla Bianchi')
    expect(m).toContain('Carla Bianchi')
  })
  it('non cattura senza keyword difensore', () => {
    const m = match(PATTERNS.DIFENSORE, 'avv. Giovanni Ferrari')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern A3 — ALLCAPS_NAME (tutto maiuscolo su riga)', () => {
  it('cattura nome tutto-maiuscolo su riga propria', () => {
    const m = match(PATTERNS.ALLCAPS_NAME, '\nLASAGNI BARBARA\n')
    expect(m).toContain('LASAGNI BARBARA')
  })
  it('cattura nome tutto-maiuscolo seguito da trattino', () => {
    const m = match(PATTERNS.ALLCAPS_NAME, '\nROSSI MARIO -\n')
    expect(m).toContain('ROSSI MARIO')
  })
  it('non cattura singole parole maiuscole', () => {
    // Solo 1 token: deve avere 2-3 token per essere un nome
    const m = match(PATTERNS.ALLCAPS_NAME, '\nROSSI\n')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B1 — DATA_NASCITA', () => {
  it('cattura data dopo "nato il"', () => {
    const m = match(PATTERNS.DATA_NASCITA, 'nato il 15/03/1978 a Roma')
    expect(m.some(v => v === '15/03/1978')).toBe(true)
  })
  it('cattura data dopo "Data di nascita:"', () => {
    const m = match(PATTERNS.DATA_NASCITA, 'Data di nascita: 15.03.1978')
    expect(m.some(v => v === '15.03.1978')).toBe(true)
  })
  it('non cattura testo senza contesto data-nascita', () => {
    const m = match(PATTERNS.DATA_NASCITA, 'il documento del 15/03/1978')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B2 — INDIRIZZO', () => {
  it('cattura indirizzo con CAP dopo "residente in"', () => {
    const m = match(PATTERNS.INDIRIZZO, 'residente in Via Roma 15, 00100')
    expect(m).toHaveLength(1)
  })
  it('cattura indirizzo dopo "domiciliato in Corso"', () => {
    const m = match(PATTERNS.INDIRIZZO, 'domiciliato in Corso Garibaldi 3, 20100')
    expect(m).toHaveLength(1)
  })
  it('non cattura indirizzo senza CAP', () => {
    const m = match(PATTERNS.INDIRIZZO, 'residente in Via Roma 15')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern B3 — NUMERO_DOCUMENTO', () => {
  it("cattura numero carta d'identità", () => {
    const m = match(PATTERNS.NUMERO_DOCUMENTO, "carta d'identità n. AB1234567")
    expect(m.some(v => v === 'AB1234567')).toBe(true)
  })
  it('cattura numero passaporto', () => {
    const m = match(PATTERNS.NUMERO_DOCUMENTO, 'passaporto: YA9876543')
    expect(m.some(v => v === 'YA9876543')).toBe(true)
  })
  it('non cattura sequenze senza contesto documento', () => {
    const m = match(PATTERNS.NUMERO_DOCUMENTO, 'codice AB1234567')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern C1 — POLIZZA_PARTE', () => {
  it('cattura nome dopo "Contraente:"', () => {
    const m = match(PATTERNS.POLIZZA_PARTE, 'Contraente: Mario Rossi')
    expect(m).toContain('Mario Rossi')
  })
  it('cattura nome dopo "Assicurato:"', () => {
    const m = match(PATTERNS.POLIZZA_PARTE, 'Assicurato: Carla Ferrari')
    expect(m).toContain('Carla Ferrari')
  })
})

describe('Pattern C2 — CONTRATTO_PARTE', () => {
  it('cattura nome in formula contrattuale "tra X, nato"', () => {
    const m = match(PATTERNS.CONTRATTO_PARTE, 'tra Mario Rossi, nato il 1980')
    expect(m).toContain('Mario Rossi')
  })
  it('cattura nome in formula "fra X, residente"', () => {
    const m = match(PATTERNS.CONTRATTO_PARTE, 'fra Luca Bianchi, residente a Milano')
    expect(m).toContain('Luca Bianchi')
  })
  it('non cattura se manca la keyword post-virgola', () => {
    const m = match(PATTERNS.CONTRATTO_PARTE, 'tra Mario Rossi, un avvocato')
    expect(m).toHaveLength(0)
  })
})

describe('Pattern C3 — PERIZIA_SOGGETTO', () => {
  it('cattura nome dopo "Paziente:"', () => {
    const m = match(PATTERNS.PERIZIA_SOGGETTO, 'Paziente: Giuseppe Verdi')
    expect(m).toContain('Giuseppe Verdi')
  })
  it('cattura nome dopo "CTU:"', () => {
    const m = match(PATTERNS.PERIZIA_SOGGETTO, 'CTU: Anna Maria Conti')
    expect(m).toContain('Anna Maria Conti')
  })
})

// ─── Blocco D: avvocati in lista e firma PKI ─────────────────────────────────

/** Estrae nomi multipli da un blocco AVV_LISTA (split su virgola) */
function matchAvvLista(text: string): string[] {
  const p = PATTERNS.AVV_LISTA
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
    const m = match(PATTERNS.PKI_FIRMA, text)
    expect(m).toContain('PASSINETTI LUISA')
    expect(m).toContain('BERTUZZI MARIO')
  })
  it('cattura singolo firmatario', () => {
    const m = match(PATTERNS.PKI_FIRMA, 'Firmato Da: ROSSI MARIO Emesso Da: CA CERT')
    expect(m).toContain('ROSSI MARIO')
  })
  it('non cattura senza keyword "Emesso"', () => {
    const m = match(PATTERNS.PKI_FIRMA, 'Firmato Da: ROSSI MARIO')
    expect(m).toHaveLength(0)
  })
})
