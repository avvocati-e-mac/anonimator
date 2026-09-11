// ============================================================
// Qualità linguistica del testo estratto.
//
// Alcuni PDF scansionati portano un layer di testo OCR inutilizzabile:
// mappa caratteri rotta, OCR eseguito nella lingua sbagliata, font privi
// di /ToUnicode. Il testo c'è, ma è spazzatura — e su spazzatura il
// riconoscimento delle entità fallisce in silenzio. Questo modulo assegna
// un punteggio di plausibilità linguistica al testo GIÀ ESTRATTO: nessun
// rendering, nessun nuovo OCR, costo praticamente nullo.
//
// PRIVACY (CLAUDE.md §6): da qui non esce mai contenuto documentale.
// Le reasons sono un'unione chiusa di letterali definita in
// src/shared/types.ts — è il compilatore a garantire che nel report che
// attraversa l'IPC non finiscano frammenti di testo. Non interpolare MAI
// porzioni del testo in ingresso dentro le reasons.
//
// Modulo PURO: nessun import di electron, fs, mupdf o logger. Solo logica
// su stringhe — è ciò che lo rende testabile senza alcun mock.
// ============================================================

import type { TextQualityVerdict, TextQualityReason } from '@shared/types'

/** Metriche grezze calcolate sul testo estratto. Solo numeri, mai testo. */
export interface TextQualityMetrics {
  /** Token che sono parole funzionali italiane sul totale dei token-parola. */
  functionWordRatio: number
  /** U+FFFD e U+0000 sul totale dei caratteri del testo. */
  replacementCharRatio: number
  /** Token di un solo carattere sul totale dei token-parola. */
  singleCharTokenRatio: number
  /** Lunghezza media dei token-parola (i token puramente numerici sono esclusi). */
  meanTokenLength: number
  /** Vocali (accentate incluse) sul totale delle lettere. */
  vowelRatio: number
  /** Numero di token-parola analizzati (denominatore di tutti i rapporti sui token). */
  tokenCount: number
}

export interface TextQualityScore {
  verdict: TextQualityVerdict
  reasons: TextQualityReason[]
  metrics: TextQualityMetrics
}

/**
 * Tutte le soglie in un punto solo: la taratura successiva tocca qui e basta.
 *
 * Valori di riferimento per la prosa italiana reale:
 *  - parole funzionali: 0,25-0,40   -> sospetto sotto 0,08
 *  - U+FFFD / U+0000:   < 0,1%      -> sospetto sopra 1%
 *  - token di 1 char:   < 10%       -> sospetto sopra 20%
 *  - lunghezza media:   4,7-5,0     -> sospetto sotto 2,5 o sopra 9
 *  - vocali/lettere:    0,45-0,50   -> sospetto fuori da 0,30-0,62
 *
 * Le soglie sono volutamente permissive: un falso positivo manda l'utente a
 * rifare un OCR inutile, quindi si accusa solo davanti a segnali netti.
 */
export const TEXT_QUALITY_TUNING = {
  /** Sotto questo numero di token-parola il campione non è significativo. */
  minTokenCount: 40,
  minFunctionWordRatio: 0.08,
  maxReplacementCharRatio: 0.01,
  maxSingleCharTokenRatio: 0.2,
  minMeanTokenLength: 2.5,
  maxMeanTokenLength: 9,
  minVowelRatio: 0.3,
  maxVowelRatio: 0.62,
  /** Numero di segnali falliti a partire dal quale il verdetto è 'poor'. */
  poorSignalCount: 2,
} as const

/**
 * Parole funzionali italiane: articoli, preposizioni (semplici, articolate ed
 * elise), congiunzioni, avverbi ad alta frequenza, pronomi, ausiliari.
 *
 * NON è una lista di termini giuridici: `legalStopWords.ts` contiene ruoli
 * processuali (ricorrente, convenuto, appellante) e serve a tutt'altro — non
 * va importato né duplicato qui.
 *
 * Perché il segnale funziona: in prosa italiana reale le parole funzionali
 * sono il 25-40% dei token; in un testo OCR degenerato crollano sotto il 5%,
 * perché sono corte e quindi le prime a essere corrotte.
 *
 * Tutte lowercase — il confronto avviene sempre su token normalizzati.
 * Le forme elise sono presenti senza apostrofo (dell, nell, all, dall, sull,
 * l, d) perché il tokenizzatore spezza sull'apostrofo: "dell'atto" produce
 * i due token "dell" e "atto".
 *
 * Nota sulle voci di un solo carattere (a, e, i, o, l, d, è): su un testo in
 * cui ogni lettera finisce in una cella separata ("A T T O D I") gonfiano il
 * rapporto e lo rendono inutile. È accettato: quel caso è già coperto, con due
 * segnali indipendenti, da singleCharTokenRatio e meanTokenLength.
 */
export const ITALIAN_FUNCTION_WORDS: ReadonlySet<string> = new Set<string>([
  // Articoli determinativi e forma elisa
  'il', 'lo', 'la', 'i', 'gli', 'le', 'l',
  // Articoli indeterminativi
  'un', 'uno', 'una',
  // Preposizioni semplici (e la elisa di "d'")
  'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'd',
  // Preposizioni articolate — di
  'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell',
  // Preposizioni articolate — a
  'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all',
  // Preposizioni articolate — da
  'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'dall',
  // Preposizioni articolate — in
  'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'nell',
  // Preposizioni articolate — su e con
  'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'sull', 'col', 'coi',
  // Congiunzioni
  'e', 'ed', 'o', 'od', 'oppure', 'ma', 'però', 'anzi', 'che', 'se',
  'come', 'quando', 'mentre', 'perché', 'poiché', 'quindi', 'dunque',
  'inoltre', 'ossia', 'cioè', 'ovvero', 'nonché', 'bensì', 'affinché',
  // Negazione e avverbi ad alta frequenza
  'non', 'più', 'meno', 'anche', 'ancora', 'già', 'solo', 'sempre', 'mai',
  'molto', 'poi', 'così', 'dove', 'qui', 'quanto',
  // Pronomi (personali, clitici, dimostrativi, relativi)
  'si', 'ci', 'vi', 'ne', 'mi', 'ti', 'chi', 'cui',
  'questo', 'questa', 'questi', 'queste', 'quel', 'quello', 'quella',
  'quelli', 'quelle', 'esso', 'essa', 'essi', 'stesso', 'stessa', 'medesimo',
  // Indefiniti
  'tale', 'tali', 'ogni', 'tutto', 'tutta', 'tutti', 'tutte',
  'altro', 'altra', 'altri', 'altre', 'alcuni', 'alcune', 'nessuno',
  // Ausiliari — essere
  'è', 'sono', 'sia', 'siano', 'era', 'erano', 'essere', 'stato', 'stata',
  'stati', 'state', 'fu', 'furono', 'sarà', 'saranno',
  // Ausiliari — avere
  'ha', 'hanno', 'ho', 'avere', 'aveva', 'avevano', 'avuto', 'abbia',
  'abbiano', 'avrà', 'avranno',
  // Verbi di supporto ad alta frequenza nei testi giuridici
  'viene', 'vengono', 'venne', 'deve', 'devono', 'può', 'possono',
])

/**
 * Token = sequenza di lettere e/o cifre Unicode. Flag `u` obbligatoria:
 * il testo contiene accenti italiani (à, è, ì, ò, ù) che con `\w` andrebbero
 * persi. L'apostrofo separa i token, quindi le forme elise compaiono come
 * token autonomi ("dell", "l", "d") — già previste in ITALIAN_FUNCTION_WORDS.
 */
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

/** Regex non globale: `.test()` su una regex globale è stateful e va evitato. */
const HAS_LETTER = /\p{L}/u

/** Vocali italiane, accentate incluse (la "y" non è vocale in italiano). */
const VOWELS = new Set<string>([
  'a', 'e', 'i', 'o', 'u',
  'à', 'è', 'é', 'ì', 'í', 'î', 'ò', 'ó', 'ù', 'ú',
  'ä', 'ë', 'ï', 'ö', 'ü', 'â', 'ê', 'ô', 'û',
])

/** Caratteri che segnalano una decodifica fallita a monte. */
const REPLACEMENT_CHARS = new Set<string>([
  String.fromCodePoint(0xfffd), // U+FFFD, inserito dai decoder quando la mappa caratteri fallisce
  String.fromCodePoint(0x0000), // U+0000, tipico dei layer di testo troncati
])

/**
 * Arrotonda a 4 decimali. I segnali si valutano sugli stessi valori
 * arrotondati che vengono poi riportati, così metriche e verdetto non possono
 * divergere. La risoluzione (1e-4) è molto più fine di ogni soglia.
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? round4(numerator / denominator) : 0
}

function countReplacementChars(text: string): number {
  let count = 0
  for (const char of text) {
    if (REPLACEMENT_CHARS.has(char)) count++
  }
  return count
}

/**
 * Calcola il punteggio di qualità linguistica del testo estratto.
 *
 * Verdetto: `poor` se falliscono almeno 2 segnali, `suspect` se ne fallisce
 * esattamente 1, altrimenti `good`. Sotto `minTokenCount` token il campione
 * non è significativo: si restituisce `good` con reason `text-too-short`
 * (ci si astiene, non si accusa).
 *
 * Non solleva mai eccezioni: stringa vuota o di soli spazi sono input validi.
 */
export function scoreTextQuality(text: string): TextQualityScore {
  const replacementCharRatio = ratio(countReplacementChars(text), text.length)

  const rawTokens = text.match(TOKEN_PATTERN) ?? []

  // SCELTA: i token puramente numerici sono esclusi da TUTTE le metriche sui
  // token (lunghezza media, token singoli, parole funzionali, conteggio).
  // Un atto legale è pieno di date, importi, numeri di ruolo e articoli di
  // legge: includerli falserebbe la lunghezza media — un "2024" o un "5" non
  // dice nulla sulla qualità della decodifica dei caratteri — e gonfierebbe
  // i token di un solo carattere. Restano invece i token misti tipo "art5",
  // che contengono almeno una lettera e portano quindi informazione sul
  // layer di testo.
  const tokens: string[] = []
  for (const raw of rawTokens) {
    if (HAS_LETTER.test(raw)) tokens.push(raw.toLowerCase())
  }

  const tokenCount = tokens.length

  let functionWordHits = 0
  let singleCharTokens = 0
  let totalTokenLength = 0
  let letters = 0
  let vowels = 0

  for (const token of tokens) {
    if (ITALIAN_FUNCTION_WORDS.has(token)) functionWordHits++
    if (token.length === 1) singleCharTokens++
    totalTokenLength += token.length
    for (const char of token) {
      if (!HAS_LETTER.test(char)) continue
      letters++
      if (VOWELS.has(char)) vowels++
    }
  }

  const metrics: TextQualityMetrics = {
    functionWordRatio: ratio(functionWordHits, tokenCount),
    replacementCharRatio,
    singleCharTokenRatio: ratio(singleCharTokens, tokenCount),
    meanTokenLength: ratio(totalTokenLength, tokenCount),
    vowelRatio: ratio(vowels, letters),
    tokenCount,
  }

  // Campione troppo piccolo: astenersi. Le metriche restano comunque
  // disponibili per la diagnostica, ma non producono accuse.
  if (tokenCount < TEXT_QUALITY_TUNING.minTokenCount) {
    return { verdict: 'good', reasons: ['text-too-short'], metrics }
  }

  const reasons: TextQualityReason[] = []

  if (metrics.functionWordRatio < TEXT_QUALITY_TUNING.minFunctionWordRatio) {
    reasons.push('low-function-word-ratio')
  }
  if (metrics.replacementCharRatio > TEXT_QUALITY_TUNING.maxReplacementCharRatio) {
    reasons.push('replacement-chars')
  }
  if (metrics.singleCharTokenRatio > TEXT_QUALITY_TUNING.maxSingleCharTokenRatio) {
    reasons.push('many-single-char-tokens')
  }
  if (
    metrics.meanTokenLength < TEXT_QUALITY_TUNING.minMeanTokenLength ||
    metrics.meanTokenLength > TEXT_QUALITY_TUNING.maxMeanTokenLength
  ) {
    reasons.push('abnormal-token-length')
  }
  if (
    metrics.vowelRatio < TEXT_QUALITY_TUNING.minVowelRatio ||
    metrics.vowelRatio > TEXT_QUALITY_TUNING.maxVowelRatio
  ) {
    reasons.push('abnormal-vowel-ratio')
  }

  let verdict: TextQualityVerdict = 'good'
  if (reasons.length >= TEXT_QUALITY_TUNING.poorSignalCount) verdict = 'poor'
  else if (reasons.length === 1) verdict = 'suspect'

  return { verdict, reasons, metrics }
}
