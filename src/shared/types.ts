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
  SESSION_RESET: 'session:reset',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  LLM_TEST: 'llm:test',
  LLM_LIST_MODELS: 'llm:listModels'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// Formati documento supportati
export type DocumentFormat = 'pdf' | 'docx' | 'odt' | 'txt' | 'image'

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

// Una singola entità trovata nel documento
export interface DetectedEntity {
  id: string
  type: EntityType
  originalText: string
  pseudonym: string
  occurrences: number
  confirmed: boolean // l'utente ha confermato l'anonimizzazione
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
}

// Richiesta di anonimizzazione (Renderer → Main)
export interface AnonymizeRequest {
  filePath: string
  entities: DetectedEntity[] // con confirmed aggiornato dall'utente
}

// Risposta dopo il salvataggio (Main → Renderer)
export interface SaveResult {
  outputPath: string
  entitiesReplaced: number
}

// ─── Configurazione LLM locale ───────────────────────────────────────────────

export interface LlmConfig {
  enabled: boolean
  baseUrl: string    // es. "http://localhost:11434/v1" (Ollama) o "http://localhost:1234/v1" (LM Studio)
  model: string      // es. "llama3.2" o "mistral"
  maxTokens: number
  timeoutMs: number
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  enabled: false,
  baseUrl: 'http://localhost:11434/v1',
  model: '',
  maxTokens: 8192,
  timeoutMs: 120000
}
