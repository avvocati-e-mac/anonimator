import { pipeline, env } from '@huggingface/transformers'
import type {
  TokenClassificationSingle,
  TokenClassificationOutput
} from '@huggingface/transformers'

// Tipo funzionale del pipeline NER — evita la union type troppo complessa di Transformers.js
type NerPipelineFn = (text: string) => Promise<TokenClassificationOutput | TokenClassificationOutput[]>
import { join } from 'path'
import log from 'electron-log'
import type { DetectedEntity, EntityType, LlmConfig } from '@shared/types'
import { detectNamesWithLlm } from './llmService'
import { sessionManager } from './sessionManager'

// ─── Configurazione Transformers.js ──────────────────────────────────────────
// Disabilita qualunque tentativo di download dalla rete
env.allowRemoteModels = false
env.allowLocalModels = true

// ─── Path modello NER ─────────────────────────────────────────────────────────
// In produzione: process.resourcesPath = Contents/Resources/ (fuori dall'asar)
//   ed è lì che electron-builder copia extraResources → path corretto.
// In dev mode: process.resourcesPath punta a node_modules/electron/dist/.../Resources
//   (la cartella dell'Electron binario) — NON contiene i modelli.
//   In quel caso usiamo __dirname (out/main/) risalendo due livelli alla root progetto.
function getModelPath(): string {
  const prodPath = join(process.resourcesPath, 'resources', 'models', 'italian-ner-xxl-v2')
  const devPath  = join(__dirname, '..', '..', 'resources', 'models', 'italian-ner-xxl-v2')
  // Se i modelli esistono in resourcesPath siamo in produzione, altrimenti dev
  return require('fs').existsSync(prodPath) ? prodPath : devPath
}

// ─── Blocklist istituzioni pubbliche (filtro post-BERT) ───────────────────────
// Scarta entità ORG che iniziano con queste parole (falsi positivi sistematici)
const PUBLIC_INSTITUTION_PREFIXES = new Set([
  'tribunale','corte','procura','pretura','questura','ministero','ministro',
  'comune','regione','provincia','prefettura','inps','inail','agenzia',
  'guardia','polizia','carabinieri','finanza','stato','repubblica',
  'governo','parlamento','senato','camera',
])

// ─── Blocklist frammenti PKI (filtro post-BERT) ───────────────────────────────
// Scarta token corti tipici di certificati digitali (NG, CA, G3, ecc.)
const PKI_NOISE = new Set(['ng','ca','ra','tsa','ocsp','crl','sub','root','g1','g2','g3','g4'])

// ─── Blocklist acronimi per Pattern A3 (tutto-maiuscolo) ─────────────────────
const ALLCAPS_BLOCKLIST = new Set([
  'inps','inail','inpgi','inpdap','spa','srl','snc','sas','sapa','onlus','ong',
  'asl','usl','ssr','ssn','pec','iban','cig','cup',
  'tribunale','corte','procura','ministero','comune','regione',
])

// ─── Soglie score differenziate per label BERT ───────────────────────────────
const SCORE_THRESHOLDS: Record<string, number> = { PER: 0.50, ORG: 0.60, LOC: 0.65 }

// ─── Regex per intestazioni sentenze italiane ────────────────────────────────
// Cattura nomi nel formato tipico delle sentenze:
//   "COGNOME NOME - Presidente -"
//   "Dott. NOME COGNOME - Consigliere -"
//   "D'ANGIOLINO AUGUSTO - Rel. Consigliere -"
// Il pattern richiede almeno 2 token di parola (nome + cognome) e la presenza
// di un ruolo giudiziario dopo il trattino per evitare falsi positivi.
const JUDICIAL_ROLES =
  'presidente|consigliere|rel\\.?\\s*consigliere|giudice|sostituto\\s+procuratore|' +
  'procuratore|cancelliere|segretario|relatore|estensore|componente'

const SENTENCE_HEADER_PATTERN = new RegExp(
  // Titolo opzionale
  '(?:(?:dott\\.?(?:ssa)?|avv\\.?|prof\\.?|ing\\.?)\\s+)?' +
  // Nome: supporta cognomi con apostrofo (D'ANGIOLINO) + 1-3 ulteriori token
  // Il primo token può essere "D'" oppure una parola maiuscola normale
  "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]*'?[A-ZÀ-Üa-zà-ü]*(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})" +
  // Separatore con ruolo giudiziario
  '\\s*[-–]\\s*(?:' + JUDICIAL_ROLES + ')\\s*[-–]',
  'gi'
)

// ─── Regex per dati strutturati italiani ─────────────────────────────────────
const REGEX_PATTERNS: { type: EntityType; pattern: RegExp }[] = [
  {
    type: 'CODICE_FISCALE',
    pattern: /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi
  },
  {
    type: 'PARTITA_IVA',
    pattern: /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi
  },
  {
    type: 'IBAN',
    pattern: /\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi
  },
  {
    type: 'TELEFONO',
    pattern: /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g
  }
]

// ─── Pattern strutturati per tipo documento (Blocco A: parti processuali) ────

// A1 — Parti del giudizio con keyword di ruolo processuale
const PROCESSO_PARTE_PATTERN = new RegExp(
  '(?:^|\\n)\\s*(?:ricorrente|resistente|appellante|appellato|intimato|' +
  'controricorrente|opponente|opposto|attore|convenuto|debitore|creditore|' +
  'fallito|fallendo|istante|intervenuto)[:\\s,]+' +
  "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})",
  'gi'
)

// A2 — Avvocati difensori
const DIFENSORE_PATTERN = new RegExp(
  '(?:difeso|difesa|rappresentato|rappresentata|assistito|assistita)\\s+' +
  "(?:dall?['\\u2019])?(?:avv\\.?|avvocato|procuratore)\\s+" +
  "([A-Z][A-Za-z\u00C0-\u00FF']+(?:\\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})",
  'gi'
)

// A3 — Nomi tutto-maiuscolo su riga propria (conservativo)
const ALLCAPS_NAME_PATTERN = new RegExp(
  '(?:^|\\n)([A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC\']{1,25}' +
  '(?:\\s+[A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC]{1,25}){1,2})' +
  '(?:\\s*$|\\s*[+]|\\s*[-\u2013]\\s*(?:$|\\n))',
  'gm'
)

// ─── Pattern strutturati per tipo documento (Blocco B: dati anagrafici) ──────

// B1 — Data di nascita → DATA_NASCITA
const DATA_NASCITA_PATTERN = /(?:nato|nata|n\.)[\s,]+(?:a\s+\S+\s+)?il\s+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})|(?:data(?:\s+di)?\s+nascita|d\.d\.n\.)[:\s]+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi

// B2 — Indirizzo di residenza/domicilio → INDIRIZZO
const INDIRIZZO_PATTERN = /(?:residente|domiciliato|domiciliata|con\s+sede)\s+(?:in\s+)?(?:Via|Viale|Corso|Piazza|Largo|Vicolo|Str\.|Loc\.|Fraz\.|V\.le)\s+[A-Za-z\u00C0-\u00FF\s0-9,.']{3,50},?\s*\d{5}/gi

// B3 — Numero documento d'identità → NUMERO_DOCUMENTO
// Usa \s* (non \s+) dopo l'apostrofo: "d'identità" non ha spazio tra ' e identità.
// Separatore [\s:,n.°]+ gestisce varianti "n.", "nr.", " : " tra keyword e numero.
const NUMERO_DOCUMENTO_PATTERN = /(?:carta(?:\s+d[i']\s*identit[àa])?|passaporto|patente|C\.I\.E?\.?)[\s:,n.°]+([A-Z]{2}[0-9]{5,7}[A-Z]?)|(?:n(?:umero)?\.?\s*doc(?:umento)?[:\s]+)([A-Z]{2}[0-9]{5,7}[A-Z]?)/gi

// ─── Pattern strutturati per tipo documento (Blocco C: intestazioni specifiche) ─

// C1 — Contraente/Assicurato/Beneficiario
const POLIZZA_PARTE_PATTERN = /(?:Contraente|Assicurato|Assicurata|Beneficiario|Intestatario)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi

// C2 — Parti del contratto (formula "tra X, nato/residente")
const CONTRATTO_PARTE_PATTERN = /(?:tra|fra)\s+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}),\s+(?:nato|nata|residente|domiciliato|codice\s+fiscale|con\s+sede)/gi

// C3 — Paziente/CTU/CTP/Perito
const PERIZIA_SOGGETTO_PATTERN = /(?:Paziente|CTU|C\.T\.U\.|CTP|C\.T\.P\.|Perito|Esaminato|Esaminata)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi

// ─── Pattern strutturati per tipo documento (Blocco D: avvocati e firma PKI) ──

// D1 — Avvocati nel formato lista: "avvocati NOME COGNOME, NOME COGNOME"
// Cattura l'intero blocco nomi dopo la keyword; i singoli nomi vengono estratti
// con split su virgola (vedi Step 0c in analyzeText).
const AVV_LISTA_PATTERN = /avvocat[oi]\s+((?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})(?:\s*,\s*(?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}))*)/gi

// D2 — Firma digitale PKI: "Firmato Da: COGNOME NOME Emesso Da:"
// Presente nell'header/footer dei documenti firmati digitalmente con ArubaPEC, ecc.
const PKI_FIRMA_PATTERN = /Firmato\s+Da:\s+([A-Z][A-Z\u00C0-\u00DC]+\s+[A-Z][A-Z\u00C0-\u00DC]+)\s+Emesso/gi

// ─── Array unificato pattern strutturati legali ───────────────────────────────
const STRUCTURED_LEGAL_PATTERNS: { pattern: RegExp; type: EntityType }[] = [
  { pattern: PROCESSO_PARTE_PATTERN,   type: 'PERSONA' },
  { pattern: DIFENSORE_PATTERN,        type: 'PERSONA' },
  { pattern: ALLCAPS_NAME_PATTERN,     type: 'PERSONA' },
  { pattern: DATA_NASCITA_PATTERN,     type: 'DATA_NASCITA' },
  { pattern: INDIRIZZO_PATTERN,        type: 'INDIRIZZO' },
  { pattern: NUMERO_DOCUMENTO_PATTERN, type: 'NUMERO_DOCUMENTO' },
  { pattern: POLIZZA_PARTE_PATTERN,    type: 'PERSONA' },
  { pattern: CONTRATTO_PARTE_PATTERN,  type: 'PERSONA' },
  { pattern: PERIZIA_SOGGETTO_PATTERN, type: 'PERSONA' },
]

/** Controlla se un testo è tutto-maiuscolo (esclusi spazi e apostrofi) */
function isAllCaps(text: string): boolean {
  return /^[A-Z\u00C0-\u00DC\s']+$/.test(text)
}

// ─── Mapping etichette modello → EntityType interno ───────────────────────────
// Laibniz/italian-ner-pii-browser-distilbert produce etichette semplici (no BIO):
// PER → PERSONA, LOC → LUOGO, ORG → ORGANIZZAZIONE, MISC → ignorato
const LABEL_TO_ENTITY_TYPE: Record<string, EntityType> = {
  PER: 'PERSONA',
  LOC: 'LUOGO',
  ORG: 'ORGANIZZAZIONE'
  // MISC ignorato: troppo generico
}

/** Normalizza etichetta: rimuove eventuale prefisso B-/I- (robustezza) */
function normalizeLabel(label: string): string {
  return label.replace(/^[BI]-/, '').toUpperCase()
}

// ─── Singleton pipeline NER ───────────────────────────────────────────────────
let nerPipeline: NerPipelineFn | null = null
let modelLoadFailed = false

async function getNerPipeline(): Promise<NerPipelineFn | null> {
  if (nerPipeline) return nerPipeline
  if (modelLoadFailed) return null

  try {
    const modelPath = getModelPath()
    log.info('Caricamento modello NER...', { path: modelPath })
    const startMs = Date.now()

    // Usa fino a 4 thread per l'inferenza ORT (senza overhead eccessivo su ARM)
    const numThreads = Math.min(4, require('os').cpus().length)

    nerPipeline = await pipeline('token-classification', modelPath, {
      local_files_only: true,
      model_file_name: 'model_quantized',
      session_options: {
        intraOpNumThreads: numThreads,
        interOpNumThreads: 1
      }
    }) as unknown as NerPipelineFn

    log.info('Modello NER caricato', { ms: Date.now() - startMs, threads: numThreads })
    return nerPipeline
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('Modello NER non disponibile, fallback a sole regex', { error: message })
    modelLoadFailed = true
    return null
  }
}

// ─── Helper: costruisce DetectedEntity senza pseudonimo ──────────────────────
// LUOGO viene impostato confirmed:false di default perché spesso i luoghi
// non devono essere anonimizzati (es. "Roma", "Milano" nei documenti legali)
function buildEntity(originalText: string, type: EntityType): DetectedEntity {
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    originalText,
    pseudonym: '', // assegnato da sessionManager.enrichEntities()
    occurrences: 0,
    confirmed: type !== 'LUOGO'
  }
}

// ─── Conta occorrenze ─────────────────────────────────────────────────────────
function countOccurrences(text: string, entityText: string): number {
  const escaped = entityText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(escaped, 'gi')) ?? []).length
}

// ─── Deduplicazione COGNOME NOME / Nome Cognome ───────────────────────────────
// Parole da ignorare nel confronto (non distinguono un nome da un altro)
const NAME_STOPWORDS = new Set([
  'dott', 'dott.ssa', 'avv', 'ing', 'prof', 'sig', 'sig.ra', 'on', 'dr',
  'presidente', 'consigliere', 'giudice', 'relatore', 'ricorrente', 'appellante',
  'resistente', 'convenuto', 'attore', 'equa', 'riparazione', 'sez', 'sezione',
  'di', 'del', 'della', 'dello', 'dei', 'degli', 'da', 'in', 'con', 'per', 'tra',
  'il', 'lo', 'la', 'le', 'gli', 'un', 'una', 'e', 'o', '-',
])

/**
 * Estrae i token significativi di un nome (lowercase, senza titoli/ruoli/stopword).
 * Es. "Dott. MARIO BERTUZZI - Presidente" → {"mario", "bertuzzi"}
 */
function nameTokenSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[.\-–,;:()]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w))
  )
}

/**
 * Restituisce true se due testi si riferiscono alla stessa persona/entità.
 * Casi gestiti:
 *   - Ordine invertito: "ROSSI MARIO" === "Mario Rossi"
 *   - Testo lungo contiene testo corto: "Dott. MARIO BERTUZZI - Presidente" contiene {"mario","bertuzzi"}
 * Richiede almeno 2 token significativi in comune e che il set più piccolo
 * sia completamente contenuto nel set più grande.
 */
function isSameName(a: string, b: string): boolean {
  const setA = nameTokenSet(a)
  const setB = nameTokenSet(b)
  if (setA.size < 2 || setB.size < 2) return false
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA]
  // Tutti i token del set più piccolo devono essere nel più grande
  for (const token of smaller) {
    if (!larger.has(token)) return false
  }
  return true
}

// ─── Post-processing output BIO: aggrega token consecutivi della stessa entità ─
interface AggregatedEntity {
  word: string
  label: string
  score: number
}

function aggregateBioTokens(items: TokenClassificationSingle[]): AggregatedEntity[] {
  const aggregated: AggregatedEntity[] = []
  let current: AggregatedEntity | null = null

  // Limite parole per entità: nessun nome/luogo/org reale supera 5 parole
  const MAX_WORDS = 5

  for (const item of items) {
    const normalized = normalizeLabel(item.entity)
    if (normalized === 'O') { if (current) { aggregated.push(current); current = null } continue }

    const isWordPieceContinuation = item.word.startsWith('##')
    const isSameEntity = current && current.label === normalized && !item.entity.startsWith('B-')
    const currentWordCount = current ? current.word.split(' ').length : 0

    if (isWordPieceContinuation && current) {
      // Subword token: concatena senza spazio
      current.word += item.word.replace(/^##/, '')
      current.score = Math.min(current.score, item.score)
    } else if (isSameEntity && currentWordCount < MAX_WORDS) {
      // Stesso tipo, token continuazione entro limite parole:
      // - se il token corrente è un'apostrofo o la parola precedente finisce con '
      //   concatena senza spazio (es. D' + ANGIOLINO → D'ANGIOLINO)
      // - altrimenti concatena con spazio
      const prevWord = current!.word
      const noSpace = prevWord.endsWith("'") || item.word.startsWith("'") || item.word === "'"
      current!.word += noSpace ? item.word : ' ' + item.word
      current!.score = Math.min(current!.score, item.score)
    } else {
      // Nuova entità (o entità corrente troppo lunga → la chiude e ne apre una nuova)
      if (current) aggregated.push(current)
      current = { word: item.word, label: normalized, score: item.score }
    }
  }
  if (current) aggregated.push(current)

  return aggregated
}

// ─── Analisi principale ───────────────────────────────────────────────────────

export interface NerAnalysisResult {
  entities: DetectedEntity[]
  nerUsed: boolean
  llmUsed: boolean
  warnings: string[]
}

export async function analyzeText(
  text: string,
  llmConfig?: LlmConfig,
  onLlmProgress?: (page: number, total: number) => void
): Promise<NerAnalysisResult> {
  const warnings: string[] = []
  const foundTexts = new Set<string>()
  let allEntities: DetectedEntity[] = []
  let nerUsed = false
  let llmUsed = false

  // 0. Parser intestazione sentenze — regex strutturata ad alta precisione
  //    Cattura "COGNOME NOME - Presidente/Consigliere/... -" prima del BERT
  //    perché il modello BERT manca sistematicamente questi pattern.
  SENTENCE_HEADER_PATTERN.lastIndex = 0
  for (const match of text.matchAll(SENTENCE_HEADER_PATTERN)) {
    const raw = match[1].trim()
    if (!raw || raw.split(/\s+/).length < 2) continue
    if (foundTexts.has(raw.toLowerCase())) continue
    foundTexts.add(raw.toLowerCase())
    allEntities.push(buildEntity(raw, 'PERSONA'))
  }

  // 0b. Pattern strutturati per tipo documento (parti processuali, dati anagrafici, polizze, contratti, perizie)
  for (const { pattern, type } of STRUCTURED_LEGAL_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[2] ?? match[0]).trim()
      if (!raw) continue
      // Per entità PERSONA richiedi almeno 2 token; per gli altri tipi basta 1
      if (type === 'PERSONA' && raw.split(/\s+/).length < 2) continue
      if (foundTexts.has(raw.toLowerCase())) continue
      // Pattern A3 (tutto-maiuscolo): filtro aggiuntivo
      if (type === 'PERSONA' && isAllCaps(raw)) {
        const tokens = raw.split(/\s+/)
        if (tokens.some((t) => t.length <= 2 || ALLCAPS_BLOCKLIST.has(t.toLowerCase()))) continue
      }
      foundTexts.add(raw.toLowerCase())
      allEntities.push(buildEntity(raw, type))
    }
  }

  // 0c. Pattern speciali con estrazione multi-nome
  //     D1: lista avvocati "avvocati NOME A, NOME B" → split su virgola
  //     D2: firma digitale PKI "Firmato Da: COGNOME NOME Emesso Da:"
  AVV_LISTA_PATTERN.lastIndex = 0
  for (const match of text.matchAll(AVV_LISTA_PATTERN)) {
    const block = match[1].trim()
    const names = block.split(/\s*,\s*/).map((s) => s.trim()).filter((s) => s.length > 2)
    for (const name of names) {
      if (name.split(/\s+/).length < 2) continue
      if (foundTexts.has(name.toLowerCase())) continue
      foundTexts.add(name.toLowerCase())
      allEntities.push(buildEntity(name, 'PERSONA'))
    }
  }

  PKI_FIRMA_PATTERN.lastIndex = 0
  for (const match of text.matchAll(PKI_FIRMA_PATTERN)) {
    const raw = match[1].trim()
    if (!raw || foundTexts.has(raw.toLowerCase())) continue
    foundTexts.add(raw.toLowerCase())
    allEntities.push(buildEntity(raw, 'PERSONA'))
  }

  // 1. Regex — veloci, deterministiche, sempre eseguite
  for (const { type, pattern } of REGEX_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[0]).trim()
      if (!raw || foundTexts.has(raw.toLowerCase())) continue
      foundTexts.add(raw.toLowerCase())
      allEntities.push(buildEntity(raw, type))
    }
  }

  // 2. NER con modello BERT (se disponibile)
  const pipe = await getNerPipeline()
  if (pipe) {
    try {
      const chunks = splitTextIntoChunks(text, 400)
      // Processa i chunk in parallelo (batch da 4) per sfruttare i thread ORT
      const BATCH = 4
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH)
        const results = await Promise.all(batch.map((chunk) => pipe(chunk)))
        for (const raw of results) {
          // Normalizza: il risultato può essere array piatto o array di array (batch)
          const flat: TokenClassificationSingle[] = Array.isArray(raw[0])
            ? (raw as TokenClassificationOutput[]).flat()
            : (raw as TokenClassificationOutput)

          const aggregated = aggregateBioTokens(flat)

          for (const { word, label, score } of aggregated) {
            const threshold = SCORE_THRESHOLDS[label] ?? 0.50
            if (score < threshold) continue
            const entityType = LABEL_TO_ENTITY_TYPE[label]
            if (!entityType) continue
            const cleaned = word.trim().replace(/^#+/, '')
            // Scarta token troppo corti, che iniziano con punto/preposizione,
            // o che sono chiaramente frammenti (es. "NG", ". A", "di Appello di Salerno")
            if (cleaned.length < 3) continue
            if (/^[.\s]/.test(cleaned)) continue
            const cleanedFirstWord = cleaned.toLowerCase().split(/\s+/)[0]
            if (NAME_STOPWORDS.has(cleanedFirstWord)) continue
            // Scarta frammenti PKI (NG, CA, G3, ecc.)
            if (PKI_NOISE.has(cleaned.toLowerCase())) continue
            // Scarta ORG che iniziano con istituzione pubblica
            if (entityType === 'ORGANIZZAZIONE' && PUBLIC_INSTITUTION_PREFIXES.has(cleanedFirstWord)) continue
            if (foundTexts.has(cleaned.toLowerCase())) continue
            foundTexts.add(cleaned.toLowerCase())
            allEntities.push(buildEntity(cleaned, entityType))
          }
        }
      }
      nerUsed = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('Errore durante inferenza NER', { error: message })
      warnings.push('Riconoscimento automatico nomi parziale. Verificare manualmente.')
    }
  } else {
    warnings.push('Modello NER non disponibile. Solo dati strutturati (CF, IBAN, ecc.) rilevati automaticamente.')
  }

  // 3. LLM locale (opzionale) — rileva nomi che il BERT può aver mancato
  if (llmConfig?.enabled && llmConfig.model) {
    try {
      // Splitta per pagine (separate da \n\n nel testo estratto da PDF/DOCX)
      // oppure chunk da 3000 char per documenti senza separatori espliciti
      const pages = text.split(/\n\n+/).filter((p) => p.trim().length > 50)
      const effectiveChunkSize = llmConfig.chunkSize ?? 3000
      const chunks = pages.length > 1 ? pages : splitTextIntoLlmChunks(text, effectiveChunkSize)
      log.info('nerService: avvio analisi LLM', { model: llmConfig.model, chunks: chunks.length })

      // Processa i chunk in batch paralleli secondo la preferenza dell'utente.
      // Ollama/LM Studio accodano le richieste concorrenti; il valore ottimale
      // dipende dalla GPU/CPU disponibile — configurabile nelle impostazioni avanzate.
      const LLM_BATCH = Math.max(1, llmConfig.parallelRequests ?? 1)
      let completed = 0
      for (let i = 0; i < chunks.length; i += LLM_BATCH) {
        const batch = chunks.slice(i, i + LLM_BATCH)
        const results = await Promise.all(
          batch.map((chunk) => detectNamesWithLlm(chunk, llmConfig))
        )
        completed += batch.length
        onLlmProgress?.(Math.min(completed, chunks.length), chunks.length)
        log.info(`nerService: LLM batch ${i / LLM_BATCH + 1} completato`, { completed, total: chunks.length })

        for (const llmNames of results) {
          for (const { original, replacement } of llmNames) {
            const trimmed = original.trim()
            if (!trimmed || foundTexts.has(trimmed.toLowerCase())) continue
            // Determina il tipo: iniziali pure (es. "M. R.") → PERSONA, altrimenti ORGANIZZAZIONE
            const type: EntityType = /^([A-Z]\.\s*)+$/.test(replacement.trim())
              ? 'PERSONA'
              : 'ORGANIZZAZIONE'
            foundTexts.add(trimmed.toLowerCase())
            const pseudonym = sessionManager.registerLlmPseudonym(trimmed, replacement.trim(), type)
            allEntities.push({ ...buildEntity(trimmed, type), pseudonym })
          }
        }
      }
      llmUsed = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('nerService: errore LLM, continuo senza', { error: message })
      warnings.push('LLM locale non raggiungibile. Usato solo BERT + regex.')
    }
  }

  // 3b. Deduplicazione varianti nome/cognome e testi che ne contengono altri
  //     Gestisce:
  //       - Ordine invertito: "ROSSI MARIO" / "Mario Rossi"
  //       - Testo lungo che contiene il nome: "Dott. MARIO BERTUZZI - Presidente" → scarta a favore di "BERTUZZI MARIO"
  //       - Cross-type: stessa stringa classificata PERSONA da NER e ORGANIZZAZIONE da LLM
  {
    const toRemove = new Set<string>()
    // Confronta tutte le coppie di entità NER (PERSONA + ORGANIZZAZIONE)
    const nerLikeEntities = allEntities.filter(
      (e) => e.type === 'PERSONA' || e.type === 'ORGANIZZAZIONE'
    )
    for (let i = 0; i < nerLikeEntities.length; i++) {
      if (toRemove.has(nerLikeEntities[i].id)) continue
      for (let j = i + 1; j < nerLikeEntities.length; j++) {
        if (toRemove.has(nerLikeEntities[j].id)) continue
        const a = nerLikeEntities[i]
        const b = nerLikeEntities[j]
        if (!isSameName(a.originalText, b.originalText)) continue

        // Sono la stessa entità — scegli quella con il testo più corto (più pulita)
        // e in parità quella con più occorrenze nel testo
        const aLen = nameTokenSet(a.originalText).size
        const bLen = nameTokenSet(b.originalText).size
        const occA = countOccurrences(text, a.originalText)
        const occB = countOccurrences(text, b.originalText)
        const [keep, drop] = aLen <= bLen && (aLen < bLen || occA >= occB)
          ? [a, b]
          : [b, a]

        // Propaga pseudonimo
        if (keep.pseudonym && !drop.pseudonym) {
          sessionManager.registerLlmPseudonym(drop.originalText, keep.pseudonym, keep.type)
        }
        toRemove.add(drop.id)
        log.info('nerService: deduplicata variante entità', {
          kept: keep.originalText,
          dropped: drop.originalText
        })
      }
    }
    if (toRemove.size > 0) {
      allEntities = allEntities.filter((e) => !toRemove.has(e.id))
    }
  }

  // 4. Cerca varianti maiuscole delle entità trovate (BERT + LLM)
  //    Es. se viene trovato "Mario Rossi", cerca anche "MARIO ROSSI" nel testo
  //    (utile per intestazioni in maiuscolo nei documenti legali)
  const nerTypes = new Set<EntityType>(['PERSONA', 'ORGANIZZAZIONE', 'LUOGO'])
  const nerEntities = allEntities.filter((e) => nerTypes.has(e.type))
  for (const entity of nerEntities) {
    const upperVariant = entity.originalText.toUpperCase()
    if (upperVariant !== entity.originalText && !foundTexts.has(upperVariant.toLowerCase())) {
      const escaped = upperVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`).test(text)) {
        foundTexts.add(upperVariant.toLowerCase())
        allEntities.push({ ...buildEntity(upperVariant, entity.type), pseudonym: entity.pseudonym })
      }
    }
  }

  // 5. Conta occorrenze
  for (const entity of allEntities) {
    entity.occurrences = countOccurrences(text, entity.originalText)
  }

  // 6. Rimuovi entità NER rumorose: scarta quelle più lunghe che contengono
  //    come sottostringa un'entità più corta della stessa categoria.
  //    L'entità corta viene mantenuta se appare da sola nel testo (standalone),
  //    cioè ha più occorrenze di quante ne siano contenute nell'entità lunga.
  allEntities = allEntities.filter((entity) => {
    if (entity.occurrences === 0) return false
    if (!nerTypes.has(entity.type)) return true // mai scartare entità regex
    const shorter = allEntities.filter(
      (e) => e !== entity && e.type === entity.type && e.originalText.length < entity.originalText.length
    )
    const containsShorter = shorter.some((e) => {
      if (!entity.originalText.toLowerCase().includes(e.originalText.toLowerCase())) return false
      // Conta occorrenze standalone dell'entità corta vs occorrenze nell'entità lunga
      const shortEscaped = e.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const longEscaped = entity.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const standaloneOccurrences = (text.match(new RegExp(`\\b${shortEscaped}\\b`, 'gi')) ?? []).length
      const containedOccurrences = (text.match(new RegExp(longEscaped, 'gi')) ?? []).length
      // Scarta l'entità lunga solo se TUTTE le occorrenze del testo corto sono sottostringa di quella lunga
      return standaloneOccurrences <= containedOccurrences
    })
    return !containsShorter
  })

  // 7. Ordina per occorrenze decrescenti
  allEntities.sort((a, b) => b.occurrences - a.occurrences)

  log.info('Analisi NER completata', {
    totalEntities: allEntities.length,
    nerUsed,
    llmUsed,
    warnings: warnings.length
  })

  return { entities: allEntities, nerUsed, llmUsed, warnings }
}

/** Divide il testo in chunk da ~maxChars caratteri, spezzando su newline */
function splitTextIntoLlmChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      if (newline > start) end = newline
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

function splitTextIntoChunks(text: string, targetWords: number): string[] {
  const words = text.split(/\s+/)
  if (words.length <= targetWords) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    let end = Math.min(start + targetWords, words.length)
    if (end < words.length) {
      for (let i = end; i > end - 20 && i > start; i--) {
        if (/[.?!]$/.test(words[i - 1])) { end = i; break }
      }
    }
    chunks.push(words.slice(start, end).join(' '))
    start = end
  }

  return chunks
}
