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

// Una singola entità trovata nel documento
export interface DetectedEntity {
  id: string
  type: EntityType
  originalText: string
  pseudonym: string
  occurrences: number
  confirmed: boolean // l'utente ha confermato l'anonimizzazione
  fileCount?: number // numero di file in cui appare (usato nel batch review)
  /** Origine dell'entità — usato internamente nel Main per filtri e boosting.
   *  Il Renderer riceve questo campo ma non lo usa per la UI. */
  source?: 'regex' | 'ner' | 'llm' | 'coref' | 'boosted'
}

// Stato di avanzamento durante il processing
export interface ProcessingProgress {
  stage: 'parsing' | 'ner' | 'ocr' | 'done'
  percent: number // 0-100
  message: string
}

// Risultato dell'analisi del documento (Main → Renderer)
export interface DocumentAnalysisResult {
  fileName: string
  format: DocumentFormat
  pageCount: number
  entities: DetectedEntity[]
  warnings: string[]
  isScanned?: boolean   // true per PDF scansionati (testo estratto via OCR, nessun layer testo nativo)
  previewHtml?: string  // solo per DOCX: HTML formattato generato da mammoth per l'anteprima in EntityReview
}

// Richiesta di anonimizzazione (Renderer → Main)
export interface AnonymizeRequest {
  filePath: string
  entities: DetectedEntity[] // con confirmed aggiornato dall'utente
  isScanned?: boolean        // true per PDF scansionati (output via rettangoli su immagine)
}

// Risposta dopo il salvataggio (Main → Renderer)
export interface SaveResult {
  outputPath: string
  entitiesReplaced: number
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
  filePath: string
  entities: DetectedEntity[]
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
