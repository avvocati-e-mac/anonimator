import { describe, it, expect } from 'vitest'
import {
  scoreTextQuality,
  ITALIAN_FUNCTION_WORDS,
  TEXT_QUALITY_TUNING,
} from '../src/main/services/textQuality'
import type { TextQualityReason } from '../src/shared/types'

// ============================================================
// Tutti i testi qui sotto sono SINTETICI (CLAUDE.md §6): nessun
// frammento proviene da documenti reali.
// ============================================================

/**
 * U+FFFD REPLACEMENT CHARACTER, costruito da codepoint: nel sorgente non
 * finiscono byte non stampabili, che renderebbero il file binario per
 * grep e git diff.
 */
const SOST = String.fromCodePoint(0xfffd)

/** Prosa giuridica italiana ben formata, stile atto di citazione (~150 parole). */
const PROSA_BUONA = `
Con il presente atto di citazione la parte attrice espone che in data quindici
marzo duemilaventitre veniva stipulato tra le parti un contratto di appalto
avente ad oggetto il rifacimento della copertura dell'immobile sito nel comune
di riferimento. Nonostante i ripetuti solleciti, la parte convenuta non ha mai
provveduto al completamento delle opere pattuite, né ha restituito le somme che
le erano state anticipate a titolo di acconto. Per tale ragione la parte attrice
ha subito un danno che deve essere integralmente risarcito, come risulta dalla
documentazione che si produce in allegato al presente atto. Si osserva inoltre
che il comportamento tenuto dalla parte convenuta appare gravemente inadempiente
e che nessuna delle giustificazioni fornite può ritenersi idonea a escludere la
responsabilità contrattuale. Tutto ciò premesso, la parte attrice chiede che il
tribunale adito voglia accertare e dichiarare l'inadempimento della convenuta,
con vittoria di spese e competenze del presente giudizio.
`

/**
 * Layer di testo con decodifica rotta: mappa caratteri fuori posto, quindi
 * gruppi consonantici privi di senso e caratteri di sostituzione U+FFFD.
 */
const MOJIBAKE = [
  `Qsd${SOST}f mpqz${SOST}v vbnhjk qwrt${SOST}p plmnbv xcvg${SOST}jk zxcvbn mqwrtyp`,
  `Ksdfgh nbv${SOST}xz wqrtzp lkjh${SOST}f mnbvcx pqwrtz hjk${SOST}mn vbnmqw`,
  `Trbnl dstr${SOST}t zprvnc mlnsg brgm trst npl frnz vnz`,
  `Ksdfgh nbvcxz wqrt${SOST}p lkjhgf mnbvcx pqwrtz hjklmn vbnmqw`,
  `Qsdrf mpqzxv vbn${SOST}jk qwrtzp plmnbv xcvghjk zxcvbn mqwrtyp`,
].join('\n')

/** OCR con font privo di /ToUnicode: ogni lettera finisce in una cella separata. */
const LETTERE_SPAZIATE =
  'A T T O   D I   C I T A Z I O N E   I N N A N Z I   A L   ' +
  'T R I B U N A L E   C I V I L E   D I   P R I M O   G R A D O   ' +
  'P E R   L A   P A R T E   A T T R I C E'

/** OCR eseguito nella lingua sbagliata: parole plausibili, ma non italiane. */
const LINGUA_SBAGLIATA = `
The undersigned hereby declares that the whole of the aforesaid property shall
be transferred pursuant to the terms hereunder written, and that any breach
thereof entitles the aggrieved party to seek damages before the competent court.
Whereas the parties have mutually agreed upon the schedule attached hereto, they
further acknowledge that no additional notice shall be required, save where such
notice becomes necessary by reason of unforeseen circumstances arising after the
effective date.
`

/** Prosa buona, ma con caratteri di sostituzione sparsi: deve fallire UN solo segnale. */
const PROSA_CON_CARATTERI_ROTTI = PROSA_BUONA + ` ${SOST}`.repeat(30)

const TESTO_CORTO = 'Il presente atto è depositato in data odierna.'

const REASONS_VALIDE: ReadonlySet<string> = new Set<TextQualityReason>([
  'text-too-short',
  'low-function-word-ratio',
  'replacement-chars',
  'many-single-char-tokens',
  'abnormal-token-length',
  'abnormal-vowel-ratio',
])

describe('scoreTextQuality — prosa italiana ben formata', () => {
  it('classifica come good un atto di citazione sintetico', () => {
    const risultato = scoreTextQuality(PROSA_BUONA)
    expect(risultato.verdict).toBe('good')
    expect(risultato.reasons).toEqual([])
  })

  it('produce metriche nelle bande attese per l\'italiano', () => {
    const { metrics } = scoreTextQuality(PROSA_BUONA)
    expect(metrics.tokenCount).toBeGreaterThanOrEqual(TEXT_QUALITY_TUNING.minTokenCount)
    expect(metrics.functionWordRatio).toBeGreaterThan(0.2)
    expect(metrics.replacementCharRatio).toBe(0)
    expect(metrics.vowelRatio).toBeGreaterThan(0.4)
    expect(metrics.vowelRatio).toBeLessThan(0.55)
  })
})

describe('scoreTextQuality — layer di testo degenerato', () => {
  it('classifica come poor il testo mojibake con caratteri di sostituzione', () => {
    const risultato = scoreTextQuality(MOJIBAKE)
    expect(risultato.verdict).toBe('poor')
    expect(risultato.reasons).toContain('replacement-chars')
    expect(risultato.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('classifica come poor il testo con ogni lettera separata da spazio', () => {
    const risultato = scoreTextQuality(LETTERE_SPAZIATE)
    expect(risultato.verdict).toBe('poor')
    expect(risultato.reasons).toContain('many-single-char-tokens')
    expect(risultato.reasons).toContain('abnormal-token-length')
    expect(risultato.metrics.singleCharTokenRatio).toBe(1)
  })

  it('sul testo spaziato il tasso di parole funzionali NON è un segnale utile', () => {
    // Le lettere isolate coincidono con le parole funzionali di un carattere
    // (a, e, i, o, l, d): il rapporto risulta alto e il segnale non scatta.
    // È voluto — il caso è già coperto dai due segnali sulla lunghezza.
    const risultato = scoreTextQuality(LETTERE_SPAZIATE)
    expect(risultato.metrics.functionWordRatio).toBeGreaterThan(
      TEXT_QUALITY_TUNING.minFunctionWordRatio
    )
    expect(risultato.reasons).not.toContain('low-function-word-ratio')
  })

  it('rileva il crollo delle parole funzionali su OCR in lingua sbagliata', () => {
    const risultato = scoreTextQuality(LINGUA_SBAGLIATA)
    expect(risultato.metrics.functionWordRatio).toBeLessThan(
      TEXT_QUALITY_TUNING.minFunctionWordRatio
    )
    expect(risultato.reasons).toContain('low-function-word-ratio')
    expect(risultato.verdict).not.toBe('good')
  })
})

describe('scoreTextQuality — verdetto suspect con un solo segnale fallito', () => {
  it('restituisce suspect quando fallisce esattamente un segnale', () => {
    const risultato = scoreTextQuality(PROSA_CON_CARATTERI_ROTTI)
    expect(risultato.reasons).toEqual(['replacement-chars'])
    expect(risultato.verdict).toBe('suspect')
  })

  it('i caratteri di sostituzione non alterano le metriche sui token', () => {
    const pulito = scoreTextQuality(PROSA_BUONA).metrics
    const sporco = scoreTextQuality(PROSA_CON_CARATTERI_ROTTI).metrics
    expect(sporco.tokenCount).toBe(pulito.tokenCount)
    expect(sporco.functionWordRatio).toBe(pulito.functionWordRatio)
    expect(sporco.meanTokenLength).toBe(pulito.meanTokenLength)
  })
})

describe('scoreTextQuality — campione non significativo', () => {
  it('si astiene sui testi troppo corti: good con reason text-too-short', () => {
    const risultato = scoreTextQuality(TESTO_CORTO)
    expect(risultato.verdict).toBe('good')
    expect(risultato.reasons).toEqual(['text-too-short'])
  })

  it('non accusa un testo corto anche se palesemente degenerato', () => {
    const risultato = scoreTextQuality(`X Y Z ${SOST} ${SOST} Q W`)
    expect(risultato.verdict).toBe('good')
    expect(risultato.reasons).toEqual(['text-too-short'])
  })

  it('gestisce la stringa vuota senza eccezioni', () => {
    const risultato = scoreTextQuality('')
    expect(risultato.verdict).toBe('good')
    expect(risultato.reasons).toEqual(['text-too-short'])
    expect(risultato.metrics.tokenCount).toBe(0)
    expect(risultato.metrics.vowelRatio).toBe(0)
    expect(risultato.metrics.replacementCharRatio).toBe(0)
  })

  it('gestisce una stringa di soli spazi e a capo senza eccezioni', () => {
    const risultato = scoreTextQuality('   \n\t  \r\n   ')
    expect(risultato.verdict).toBe('good')
    expect(risultato.reasons).toEqual(['text-too-short'])
    expect(risultato.metrics.tokenCount).toBe(0)
    expect(risultato.metrics.meanTokenLength).toBe(0)
  })

  it('gestisce un testo di soli numeri senza accusare (nessun token-parola)', () => {
    const soloNumeri = Array.from({ length: 80 }, (_, i) => String(1000 + i)).join(' ')
    const risultato = scoreTextQuality(soloNumeri)
    expect(risultato.metrics.tokenCount).toBe(0)
    expect(risultato.verdict).toBe('good')
    expect(risultato.reasons).toEqual(['text-too-short'])
  })
})

describe('scoreTextQuality — privacy delle reasons (CLAUDE.md §6)', () => {
  it('restituisce solo valori dell\'unione chiusa, mai frammenti del testo', () => {
    const testi = [
      PROSA_BUONA,
      MOJIBAKE,
      LETTERE_SPAZIATE,
      LINGUA_SBAGLIATA,
      PROSA_CON_CARATTERI_ROTTI,
      TESTO_CORTO,
      '',
    ]
    for (const testo of testi) {
      const { reasons } = scoreTextQuality(testo)
      for (const reason of reasons) {
        expect(REASONS_VALIDE.has(reason)).toBe(true)
        expect(reason).toMatch(/^[a-z-]+$/)
      }
    }
  })

  it('nessuna reason contiene parole prese dal testo analizzato', () => {
    const { reasons } = scoreTextQuality(PROSA_BUONA)
    const unite = reasons.join(' ')
    for (const parola of ['citazione', 'tribunale', 'convenuta', 'appalto', 'immobile']) {
      expect(unite).not.toContain(parola)
    }
  })

  it('le metriche sono solo numeri finiti', () => {
    const { metrics } = scoreTextQuality(MOJIBAKE)
    for (const valore of Object.values(metrics)) {
      expect(typeof valore).toBe('number')
      expect(Number.isFinite(valore)).toBe(true)
    }
  })
})

describe('ITALIAN_FUNCTION_WORDS', () => {
  it('contiene articoli, preposizioni semplici e articolate', () => {
    for (const parola of ['il', 'lo', 'la', 'gli', 'le', 'di', 'da', 'con', 'su', 'della', 'negli', 'sulle']) {
      expect(ITALIAN_FUNCTION_WORDS.has(parola)).toBe(true)
    }
  })

  it('contiene congiunzioni, negazione, pronomi e ausiliari', () => {
    for (const parola of ['e', 'ed', 'ma', 'che', 'se', 'perché', 'non', 'si', 'questo', 'sono', 'è', 'ha', 'essere']) {
      expect(ITALIAN_FUNCTION_WORDS.has(parola)).toBe(true)
    }
  })

  it('contiene le forme elise senza apostrofo, come le produce il tokenizzatore', () => {
    for (const parola of ['dell', 'nell', 'all', 'dall', 'sull', 'l', 'd']) {
      expect(ITALIAN_FUNCTION_WORDS.has(parola)).toBe(true)
    }
  })

  it('NON contiene ruoli processuali: quelli stanno in legalStopWords', () => {
    for (const parola of ['ricorrente', 'convenuto', 'appellante', 'imputato', 'tribunale', 'giudice']) {
      expect(ITALIAN_FUNCTION_WORDS.has(parola)).toBe(false)
    }
  })

  it('è tutto in lowercase', () => {
    for (const parola of ITALIAN_FUNCTION_WORDS) {
      expect(parola).toBe(parola.toLowerCase())
    }
  })

  it('ha una copertura sufficiente (almeno 100 voci)', () => {
    expect(ITALIAN_FUNCTION_WORDS.size).toBeGreaterThanOrEqual(100)
  })
})

describe('TEXT_QUALITY_TUNING', () => {
  it('espone soglie coerenti fra loro', () => {
    expect(TEXT_QUALITY_TUNING.minMeanTokenLength).toBeLessThan(TEXT_QUALITY_TUNING.maxMeanTokenLength)
    expect(TEXT_QUALITY_TUNING.minVowelRatio).toBeLessThan(TEXT_QUALITY_TUNING.maxVowelRatio)
    expect(TEXT_QUALITY_TUNING.minTokenCount).toBeGreaterThan(0)
    expect(TEXT_QUALITY_TUNING.poorSignalCount).toBe(2)
  })
})
