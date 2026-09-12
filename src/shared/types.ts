// ============================================================
// Tipi condivisi tra Main Process e Renderer (IPC contract)
// ============================================================

// Canali IPC (evita stringhe hardcoded)
export const IPC_CHANNELS = {
  DOC_PROCESS: 'doc:process',
  DOC_COMPLETE: 'doc:complete',
  DOC_ANONYMIZE: 'doc:anonymize',
  DOC_SAVED: 'doc:saved',
  DOC_ERROR: 'doc:error',
  DOC_PROGRESS: 'doc:progress',
  BATCH_ANONYMIZE: 'batch:anonymize',
  ANALYSIS_RELEASE: 'analysis:release',
  SESSION_RESET: 'session:reset',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  LLM_TEST: 'llm:test',
  LLM_LIST_MODELS: 'llm:listModels',
  LLM_GET_DEFAULT_PROMPT: 'llm:getDefaultPrompt',
  APP_GET_VERSION: 'app:getVersion',
  ENTITY_ADD: 'entity:add',
  ENTITY_EXPORT: 'entity:export',
  ENTITY_IMPORT: 'entity:import',
  SESSION_SAVE: 'session:save',
  SESSION_LOAD: 'session:load',
  SESSION_HAS_SAVED: 'session:hasSaved',
  SESSION_DELETE: 'session:delete',
  SESSION_GET_PATH: 'session:getPath',
  DIAG_COLLECT: 'diag:collect',
  MODEL_STATUS: 'model:status',
  MODEL_DOWNLOAD: 'model:download',
  MODEL_DOWNLOAD_PROGRESS: 'model:download:progress',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// Formati documento supportati
export type DocumentFormat = 'pdf' | 'docx' | 'odt' | 'txt' | 'image' | 'markdown'

// Tipi di entità riconosciute
export type EntityType =
  | 'PERSONA'
  | 'ORGANIZZAZIONE'
  | 'LUOGO'
  | 'CODICE_FISCALE'
  | 'PARTITA_IVA'
  | 'IBAN'
  | 'EMAIL'
  | 'TELEFONO'
  | 'DATA_NASCITA'
  | 'LUOGO_NASCITA'
  | 'INDIRIZZO'
  | 'NUMERO_DOCUMENTO'
  | 'TARGA'

// Una singola entità trovata nel documento
export interface DetectedEntity {
  id: string
  type: EntityType
  originalText: string
  pseudonym: string
  occurrences: number
  /** Conteggio Main-only usato dal ledger di salvataggio; null per entità manuali. */
  expectedOccurrences?: number | null
  confirmed: boolean // l'utente ha confermato l'anonimizzazione
  fileCount?: number // numero di file in cui appare (usato nel batch review)
  /** Origine dell'entità — usato internamente nel Main per filtri e boosting.
   *  Il Renderer riceve questo campo ma non lo usa per la UI. */
  source?: 'regex' | 'ner' | 'llm' | 'coref' | 'boosted'
}

// Stato di avanzamento durante il processing
export interface ProcessingProgress {
  stage: 'parsing' | 'ner' | 'ocr' | 'output' | 'done'
  percent: number // 0-100
  message: string
}

// ============================================================
// Analisi del layer OCR nei PDF (v1.6.0)
// Tutti i campi sono numerici o etichette da insiemi chiusi:
// nessun contenuto documentale può finire qui (CLAUDE.md §6).
// ============================================================

/** Natura del contenuto di un PDF, determinata dal gate di analyzeOcrLayer. */
export type PdfLayerKind =
  | 'digital'          // testo vettoriale nativo, nessuna immagine a piena pagina
  | 'scan-with-text'   // scansione con layer di testo OCR sovrapposto
  | 'scan-no-text'     // scansione senza alcun layer di testo

/** Verdetto sull'allineamento fra layer di testo e pixel della scansione. */
export type OcrLayerVerdict = 'aligned' | 'misaligned' | 'inconclusive'

export type TextQualityVerdict = 'good' | 'suspect' | 'poor'
export type ImageQualityVerdict = 'good' | 'marginal' | 'poor'

/** Motivo del verdetto di pagina. Insieme chiuso — mai testo libero. */
export type OcrPageReason =
  | 'ok'
  | 'not-raster-page'
  | 'no-text-layer'
  | 'blank-page'
  | 'dark-page'
  | 'too-few-text-cells'
  | 'ink-baseline-too-high'
  | 'pixel-view-detached'
  | 'low-coverage'
  | 'low-lift'
  | 'low-line-agreement'
  | 'scale-mismatch'
  | 'offset-too-large'
  | 'page-error'

export type TextQualityReason =
  | 'text-too-short'
  | 'low-function-word-ratio'
  | 'replacement-chars'
  | 'many-single-char-tokens'
  | 'abnormal-token-length'
  | 'abnormal-vowel-ratio'

export type ImageQualityReason =
  | 'low-native-dpi'
  | 'very-low-native-dpi'
  | 'small-x-height'
  | 'very-small-x-height'
  | 'low-separability'
  | 'skewed'
  | 'very-skewed'
  | 'possibly-blurred'

/** Metriche sulla qualità del raster sorgente, dalla stessa passata di rendering. */
export interface ImageQualityMetrics {
  /** DPI nativo del raster incorporato, non quello di rendering. null se non ricavabile. */
  nativeDpi: number | null
  /** Altezza stimata della x in pixel alla risoluzione nativa. Soglia Tesseract: 10px. */
  xHeightPx: number | null
  /** Separabilità inchiostro/carta: eta di Otsu (sigma_B^2 / sigma_T^2), 0-1. */
  separability: number
  /** Inclinazione stimata in gradi. */
  skewDeg: number
  /** Varianza del laplaciano normalizzata. SEGNALE DEBOLE: mai sufficiente da solo. */
  blurScore: number
}

/** Metriche di allineamento per una singola pagina campionata. */
export interface OcrPageMetrics {
  page: number            // 1-based
  verdict: OcrLayerVerdict
  reason: OcrPageReason
  coverage: number        // celle-testo su inchiostro / celle-testo, a shift zero
  lift: number            // coverage / baseline da piazzamento casuale
  /** null quando le righe utili sono troppo poche per calcolarla (vedi R27). */
  lineAgreement: number | null
  scaleY: number          // 1 = nessun errore di scala
  offsetXPt: number       // DIAGNOSTICO — non va mai applicato (periodicità, vedi R3)
  offsetYPt: number
}

export interface OcrLayerReport {
  layerKind: PdfLayerKind
  verdict: OcrLayerVerdict
  pagesSampled: number
  pagesMisaligned: number
  pagesInconclusive: number
  maxOffsetMm: number
  /** Firma del produttore del layer, es. 'GlyphLessFont' (Tesseract). */
  producerFont: string | null
  pages: OcrPageMetrics[]
  textQuality: TextQualityVerdict
  textQualityReasons: TextQualityReason[]
  imageQuality: ImageQualityVerdict
  imageQualityReasons: ImageQualityReason[]
  imageMetrics: ImageQualityMetrics
  /** DPI consigliato per un nuovo OCR: clamp(nativeDpi, 200, 400). */
  suggestedOcrDpi: number
  elapsedMs: number
}

/** Opzioni per doc:process (Renderer → Main). */
export interface ProcessDocumentOptions {
  /** Forza l'OCR interno ignorando il layer di testo esistente. */
  forceOcr?: boolean
  /** DPI di rendering per l'OCR forzato. Default: suggestedOcrDpi del report. */
  ocrDpi?: number
}

// Risultato dell'analisi del documento (Main → Renderer)
export interface DocumentAnalysisResult {
  /** Capability opaca, emessa dal Main e legata alla finestra e al file analizzato. */
  analysisToken: string
  fileName: string
  format: DocumentFormat
  pageCount: number
  entities: DetectedEntity[]
  warnings: string[]
  isScanned?: boolean   // true per PDF scansionati (testo estratto via OCR, nessun layer testo nativo)
  previewHtml?: string  // solo per DOCX: HTML formattato generato da mammoth per l'anteprima in EntityReview
  ocrReport?: OcrLayerReport // solo per PDF: esito del controllo su layer OCR, allineamento e qualità
}

// Richiesta di anonimizzazione (Renderer → Main)
export interface EntityDecision {
  entityId: string
  type: EntityType
  originalText: string
  pseudonym: string
  confirmed: boolean
}

export type PdfOutputMode = 'preserve-color' | 'force-bitonal'

export interface AnonymizeRequest {
  analysisToken: string
  entities: EntityDecision[]
  /** Preferenza esplicita per PDF e immagini; assente equivale a preserve-color. */
  pdfOutputMode?: PdfOutputMode
}

// Risposta dopo il salvataggio (Main → Renderer)
export type RedactionMode = 'digital' | 'flattened-scan'

export type PartialReason =
  | 'analysis-page-error'
  | 'ocr-page-error'
  | 'entity-unmatched'
  | 'entity-count-mismatch'
  | 'ambiguous-overlap'
  | 'rejected-rectangle'

export interface EntityRedactionOutcome {
  entityId: string
  expectedOccurrences: number | null
  matchedOccurrences: number
  redactedOccurrences: number
  ambiguousOccurrences: number
  rejectedOccurrences: number
}

export interface SaveResult {
  outputPath: string
  safetyStatus: 'complete' | 'partial'
  partialReasons: PartialReason[]
  outcomes: EntityRedactionOutcome[]
  entitiesReplaced: number
  /** Rapporto fra dimensione dell'output e dell'originale.
   *  La redazione reale dei pixel ri-codifica l'immagine NON compressa: una
   *  scansione JPEG può crescere di 50 volte. Con i limiti di dimensione di un
   *  deposito telematico non è un dettaglio estetico, e non va taciuto. */
  sizeRatio?: number
  /** true quando la crescita supera le soglie: va detto all'utente. */
  sizeWarning?: boolean
  redactionMode: RedactionMode
}

// ─── Batch processing ────────────────────────────────────────────────────────

export type BatchFileStatus = 'pending' | 'analyzing' | 'done' | 'error'

export interface BatchFileItem {
  filePath: string
  fileName: string
  status: BatchFileStatus
  analysisResult?: DocumentAnalysisResult
  error?: string
}

export interface BatchAnonymizeRequest {
  analysisToken: string
  entities: EntityDecision[]
  pdfOutputMode?: PdfOutputMode
}

export interface BatchResultItem {
  filePath: string
  fileName: string
  outputPath?: string
  entitiesReplaced?: number
  error?: string
}

export interface BatchSettings {
  maxConcurrency: number // 1–8, default 2
}

export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  maxConcurrency: 2,
}

// ─── Configurazione LLM locale ───────────────────────────────────────────────

export type LlmProviderType = 'ollama' | 'openai_compat'
export type LlmProviderPreset = 'ollama' | 'lmstudio' | 'mlx' | 'custom'

export interface LlmDetectedName {
  original: string
  replacement: string
}

export interface LlmConfig {
  enabled: boolean
  providerType: LlmProviderType
  providerPreset: LlmProviderPreset
  baseUrl: string    // es. "http://localhost:11434/v1" (Ollama) o "http://localhost:1234/v1" (LM Studio)
  model: string      // es. "llama3.2" o "mistral"
  maxTokens: number
  timeoutMs: number
  parallelRequests: number  // quante sezioni del documento analizza l'LLM contemporaneamente (1–4)
  customPrompt?: string     // se valorizzato, sovrascrive il prompt di default
  promptLanguage: 'it' | 'en'  // TODO [A/B-TEST]: rimuovere dopo ottimizzazione prompt
  chunkSize: number         // caratteri per chunk (1000–8000)
  stream: boolean           // disattiva lo streaming (sempre false)
  temperature: number       // impostata a 0 per estrazione deterministica
}

export interface LlmCapabilities {
  supportsStructuredOutput: boolean
  supportsJsonSchema: boolean
  supportsModelListing: boolean
}

export interface LlmTestResult {
  ok: boolean
  message: string
  models?: string[]
  capabilities?: LlmCapabilities
}

// ─── Dizionario entità esportato (file JSON) ──────────────────────────────────

export interface EntityDictionaryFile {
  version: 1
  exportedAt: string // ISO 8601
  entries: Array<{
    originalText: string
    pseudonym: string
    type: EntityType
  }>
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  enabled: false,
  providerType: 'ollama',
  providerPreset: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: '',
  maxTokens: 8192,
  timeoutMs: 120000,
  parallelRequests: 1,
  promptLanguage: 'it',  // TODO [A/B-TEST]
  chunkSize: 3000,
  stream: false,
  temperature: 0
}

// ─── Stato modello NER ────────────────────────────────────────────────────────

export interface ModelStatus {
  nerExists: boolean
  tessdataExists: boolean
  exists: boolean       // true solo se ENTRAMBI presenti
  modelPath: string
  tessdataPath: string
}

export interface ModelDownloadProgress {
  file: string      // es. 'model_quantized.onnx'
  percent: number   // 0–100 globale sui 4 file
  done: boolean
  error?: string
}
