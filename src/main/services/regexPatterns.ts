// ============================================================
// Tutti i pattern regex usati dal NER engine
// Esportati come costanti nominate per poter essere testati
// isolatamente senza caricare il modello BERT.
// ============================================================

import type { EntityType } from '@shared/types'

// ─── Costanti di supporto ────────────────────────────────────────────────────

const JUDICIAL_ROLES =
  'presidente|consigliere|rel\\.?\\s*consigliere|giudice|sostituto\\s+procuratore|' +
  'procuratore|cancelliere|segretario|relatore|estensore|componente'

// ─── Step 0 — Header di sentenza ─────────────────────────────────────────────

/**
 * Cattura nome/cognome seguito da ruolo giudiziario con trattini:
 * "Mario Rossi - Presidente -" oppure "Dott. Anna Ferrari - Relatore -"
 */
export const SENTENCE_HEADER_PATTERN = new RegExp(
  '(?:(?:dott\\.?(?:ssa)?|avv\\.?|prof\\.?|ing\\.?)\\s+)?' +
  "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]*'?[A-ZÀ-Üa-zà-ü]*(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})" +
  '\\s*[-–]\\s*(?:' + JUDICIAL_ROLES + ')\\s*[-–]',
  'gi'
)

// ─── Step 0b — Pattern strutturati contestuali legali ────────────────────────

/** ricorrente/appellante/attore/ecc. seguito dal nome della parte */
export const PROCESSO_PARTE_PATTERN = new RegExp(
  '(?:^|\\n)\\s*(?:ricorrente|resistente|appellante|appellato|intimato|' +
  'controricorrente|opponente|opposto|attore|convenuto|debitore|creditore|' +
  'fallito|fallendo|istante|intervenuto)[:\\s,]+' +
  "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})",
  'gi'
)

/** difeso/assistito dall'avv./avvocato + nome */
export const DIFENSORE_PATTERN = new RegExp(
  '(?:difeso|difesa|rappresentato|rappresentata|assistito|assistita)\\s+' +
  "(?:dall?['\\u2019])?(?:avv\\.?|avvocato|procuratore)\\s+" +
  "([A-Z][A-Za-z\u00C0-\u00FF']+(?:\\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})",
  'gi'
)

/** Nome tutto-maiuscolo su riga propria o seguito da trattino */
export const ALLCAPS_NAME_PATTERN = new RegExp(
  '(?:^|\\n)([A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC\']{1,25}' +
  '(?:\\s+[A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC]{1,25}){1,2})' +
  '(?:\\s*$|\\s*[+]|\\s*[-\u2013]\\s*(?:$|\\n))',
  'gm'
)

/** nato/nata/data di nascita + data (numerica o letterale italiana) */
export const DATA_NASCITA_PATTERN =
  /(?:nato|nata|n\.)[\s,]+(?:a\s+\S+\s+)?il\s+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})|(?:data(?:\s+di)?\s+nascita|d\.d\.n\.)[:\s]+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})/gi

/** nato/nata a <Città> il — cattura il luogo di nascita con contesto esplicito */
export const LUOGO_NASCITA_PATTERN =
  /(?:nato|nata)\s+a\s+([A-ZÀ-Üa-zà-ü][A-Za-zÀ-ÿ\s]{1,30}?)\s+il\b/gi

/**
 * Indirizzo con prefisso contestuale (residente/domiciliato/con sede).
 * Via, Viale, Piazza, Largo, Vicolo — numero civico opzionale + CAP obbligatorio.
 * NOTA: "Corso" è escluso da questo pattern — gestito da INDIRIZZO_PATTERN_CORSO
 * per evitare falsi positivi su "corso di indagini".
 */
export const INDIRIZZO_PATTERN_STANDARD =
  /(?:residente(?:\s+attualmente)?|domiciliato|domiciliata|con\s+sede|sito)\s+(?:in\s+)?(?:Via|Viale|Piazza|Largo|Vicolo|Str\.|Loc\.|Fraz\.|V\.le)\s+[A-Za-z\u00C0-\u00FF\s0-9,.']{3,50}(?:\s*[-–,]\s*\d{5}|\s*,?\s*\d{5})/gi

/**
 * "Corso" come indirizzo SOLO se preceduto dal contesto di residenza/domicilio
 * e seguito da un nome proprio (maiuscola) + numero civico.
 * "nel corso delle indagini" → non matcha (manca contesto residente/domiciliato).
 * "residente in Corso Roma 15, 00100" → matcha.
 */
export const INDIRIZZO_PATTERN_CORSO =
  /(?:residente(?:\s+attualmente)?|domiciliato|domiciliata|con\s+sede|sito)\s+(?:in\s+)?[Cc]orso\s+[A-ZÀ-Ü][A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,5},?\s*\d+[,\s]*(?:[-–]\s*)?\d{5}/gi

/**
 * Pattern combinato legacy — non usato nel codice principale.
 * Mantenuto solo per retrocompatibilità con eventuali test/script esterni.
 * @deprecated Usare INDIRIZZO_PATTERN_STANDARD + INDIRIZZO_PATTERN_CORSO separatamente.
 */
export const INDIRIZZO_PATTERN =
  /(?:residente(?:\s+attualmente)?|domiciliato|domiciliata|con\s+sede|sito)\s+(?:in\s+)?(?:Via|Viale|Corso|Piazza|Largo|Vicolo|Str\.|Loc\.|Fraz\.|V\.le)\s+[A-Za-z\u00C0-\u00FF\s0-9,.']{3,50}(?:\s*[-–,]\s*\d{5}|\s*,?\s*\d{5})/gi

/**
 * Documento d'identità — due forme:
 * 1. Con contesto: "carta d'identità / passaporto / patente / C.I." + codice
 * 2. Bare format: due lettere maiuscole + 7 cifre (es. "CA 5528847", "AO 1234567")
 *    SOLO se segue un contesto esplicito (rilasciata/emessa/n./numero/doc.)
 *    oppure è in posizione di dato anagrafico (dopo "documento:" o "doc. n.")
 */
export const NUMERO_DOCUMENTO_PATTERN =
  /(?:carta(?:\s+d[i']\s*identit[àa])?|passaporto|patente|C\.I\.E?\.?|documento\s+d'identit[àa]?)[\s:,n.°]*([A-Z]{2}\s?[0-9]{5,7}[A-Z]?)|(?:n(?:umero)?\.?\s*doc(?:umento)?[:\s]+)([A-Z]{2}\s?[0-9]{5,7}[A-Z]?)|(?:(?:rilasciata?|emessa?)\s+(?:il\s+\S+\s+)?(?:dal?\s+\S+\s+)?(?:con\s+)?(?:n[°.]?\s*|numero\s+))([A-Z]{2}\s?[0-9]{5,7}[A-Z]?)/gi

/** Targa veicolo italiana — formato moderno (AB 123 CD) e vecchio (AB12345) */
export const TARGA_PATTERN =
  /\b([A-Z]{2}\s?[0-9]{3}\s?[A-Z]{2})\b/g

/** Contraente/Assicurato/Beneficiario + nome (polizze assicurative) */
export const POLIZZA_PARTE_PATTERN =
  /(?:Contraente|Assicurato|Assicurata|Beneficiario|Intestatario)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi

/** tra/fra + nome + nato/residente/ecc. (contratti) */
export const CONTRATTO_PARTE_PATTERN =
  /(?:tra|fra)\s+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}),\s+(?:nato|nata|residente|domiciliato|codice\s+fiscale|con\s+sede)/gi

/** Paziente/CTU/CTP/Perito + nome (perizie) */
export const PERIZIA_SOGGETTO_PATTERN =
  /(?:Paziente|CTU|C\.T\.U\.|CTP|C\.T\.P\.|Perito|Esaminato|Esaminata)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi

/**
 * Titolo professionale + nome (min 2 token, iniziali maiuscole obbligatorie).
 * Copre: Ing., Dott./Dott.ssa, Dr./Dr.ssa, Prof./Prof.ssa, Sig./Sig.ra, Avv., Arch., Geom.
 * NON usa flag 'i' per evitare che minuscole seguenti al titolo vengano catturate.
 * NON matcha nome singolo (es. "Ing. Rossi") — troppo ambiguo senza cognome.
 */
export const TITOLO_NOME_PATTERN =
  /(?:Ing\.|Dott\.(?:ssa)?|Dr\.(?:ssa)?|Prof\.(?:ssa)?|Sig\.(?:ra)?|Avv\.|Arch\.|Geom\.)\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ']+(?:\s+[A-ZÀ-Ü][A-Za-zÀ-ÿ']+){1,3})/g

/** Elenco avvocati separati da virgola */
export const AVV_LISTA_PATTERN =
  /avvocat[oi]\s+((?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})(?:\s*,\s*(?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}))*)/gi

/** Firma digitale PKI: "Firmato Da: NOME COGNOME Emesso Da:" */
export const PKI_FIRMA_PATTERN =
  /Firmato\s+Da:\s+([A-Z][A-Z\u00C0-\u00DC]+\s+[A-Z][A-Z\u00C0-\u00DC]+)\s+Emesso/gi

// ─── Step 0b — Array aggregato (usato in nerService.ts) ──────────────────────

export const STRUCTURED_LEGAL_PATTERNS: { pattern: RegExp; type: EntityType }[] = [
  { pattern: PROCESSO_PARTE_PATTERN,    type: 'PERSONA' },
  { pattern: DIFENSORE_PATTERN,         type: 'PERSONA' },
  { pattern: ALLCAPS_NAME_PATTERN,      type: 'PERSONA' },
  { pattern: LUOGO_NASCITA_PATTERN,     type: 'LUOGO_NASCITA' },
  { pattern: DATA_NASCITA_PATTERN,      type: 'DATA_NASCITA' },
  { pattern: INDIRIZZO_PATTERN_STANDARD, type: 'INDIRIZZO' },
  { pattern: INDIRIZZO_PATTERN_CORSO,   type: 'INDIRIZZO' },
  { pattern: NUMERO_DOCUMENTO_PATTERN,  type: 'NUMERO_DOCUMENTO' },
  { pattern: POLIZZA_PARTE_PATTERN,     type: 'PERSONA' },
  { pattern: CONTRATTO_PARTE_PATTERN,   type: 'PERSONA' },
  { pattern: PERIZIA_SOGGETTO_PATTERN,  type: 'PERSONA' },
  { pattern: TITOLO_NOME_PATTERN,       type: 'PERSONA' },
  { pattern: TARGA_PATTERN,             type: 'TARGA' },
]

// ─── Step 1 — Pattern strutturati (dati personali formali) ──────────────────

/**
 * Codice Fiscale — pattern lenient (default).
 * Valida il formato generale ma non la lettera di mese né il range giorno.
 * Default lenient perché l'OCR può distorcere lettere (B→8, O→0).
 */
export const CODICE_FISCALE_PATTERN_LENIENT =
  /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi

/**
 * Codice Fiscale — pattern strict.
 * Valida anche la lettera di mese (solo A,B,C,D,E,H,L,M,P,R,S,T)
 * e il range giorno (01–71, dove ≥32 indica donna).
 * Usare su documenti nativi (non OCR) per ridurre falsi positivi.
 */
export const CODICE_FISCALE_PATTERN_STRICT =
  /\b[A-Z]{6}[0-9]{2}[ABCDEHLMPRST](?:0[1-9]|[1-6][0-9]|7[01])[A-Z][0-9]{3}[A-Z]\b/gi

/** Partita IVA — 11 cifre, opzionalmente preceduto da "P.IVA" */
export const PARTITA_IVA_PATTERN =
  /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi

/** IBAN italiano — gestisce sia formato compatto che con spazi ogni 4 char */
export const IBAN_PATTERN =
  /\bIT[0-9]{2}(?:\s?[A-Z0-9]){23}\b/gi

/** Indirizzo email */
export const EMAIL_PATTERN =
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi

/** Numero di telefono italiano (fisso o mobile) */
export const TELEFONO_PATTERN =
  /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g

/** Array aggregato dei pattern strutturati formali (usato in nerService.ts) */
export const REGEX_PATTERNS: { type: EntityType; pattern: RegExp }[] = [
  { type: 'CODICE_FISCALE', pattern: CODICE_FISCALE_PATTERN_LENIENT },
  { type: 'PARTITA_IVA',    pattern: PARTITA_IVA_PATTERN },
  { type: 'IBAN',           pattern: IBAN_PATTERN },
  { type: 'EMAIL',          pattern: EMAIL_PATTERN },
  { type: 'TELEFONO',       pattern: TELEFONO_PATTERN },
]
