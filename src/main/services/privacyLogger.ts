import log from 'electron-log'

/**
 * Logging Main sicuro per contenuto documentale.
 *
 * Gli eventi devono essere stringhe letterali. I metadati attraversano comunque
 * una allowlist a runtime: valori e chiavi non riconosciuti vengono scartati, mai
 * serializzati. In particolare questo modulo non accetta percorsi, nomi file,
 * testo, pseudonimi, URL, risposte LLM o oggetti Error.
 */

type LiteralString<Value extends string> = string extends Value ? never : Value

const NUMBER_KEYS = new Set([
  'avgCharsPerPage',
  'avgConfidence',
  'bytes',
  'chars',
  'chunkSize',
  'confidence',
  'count',
  'dpi',
  'dpiRequested',
  'elapsedMs',
  'entities',
  'entitiesConfirmed',
  'entitiesReplaced',
  'entries',
  'heapDeltaMB',
  'imported',
  'matchedOccurrences',
  'ms',
  'page',
  'pageCount',
  'pages',
  'paragraphs',
  'pagesRedacted',
  'pagesSampled',
  'percent',
  'previousSize',
  'raw',
  'responseChars',
  'rejectedOccurrences',
  'sizeRatio',
  'threads',
  'total',
  'totalEntities',
  'validated',
  'warnings',
  'wordCount',
])

const BOOLEAN_KEYS = new Set([
  'bindingExists',
  'detectLibcExists',
  'deskewApplied',
  'enabled',
  'hasCustomPrompt',
  'hasInferenceSession',
  'hasPreview',
  'isPackaged',
  'isScanned',
  'llmUsed',
  'modelExists',
  'nerUsed',
  'sizeWarning',
  'tessdataExists',
])

const TOKEN_ARRAY_KEYS = new Set(['errorCodes', 'partialReasons'])

const SAFE_VALUES_BY_KEY: Readonly<Record<string, ReadonlySet<string>>> = {
  arch: new Set(['arm', 'arm64', 'ia32', 'x64']),
  code: new Set([
    'generation-error', 'invalid-payload', 'unexpected-error',
    'invalid-json',
    'unknown-token', 'token-owner-mismatch', 'source-changed', 'entity-ledger-mismatch',
    'resource-limit', 'unreadable-pdf', 'render-failed', 'validation-failed',
    'write-failed', 'ocr-artifact-missing', 'ocr-unavailable', 'ocr-failed',
  ]),
  errorCode: new Set([
    'abort-error', 'connection-refused', 'connection-reset', 'dns-failed',
    'entity-ledger-mismatch', 'file-exists', 'file-not-found', 'network-timeout',
    'no-space', 'ocr-artifact-missing', 'ocr-unavailable', 'ocr-failed', 'permission-denied', 'render-failed',
    'resource-limit', 'source-changed', 'token-owner-mismatch', 'too-many-open-files',
    'unexpected-error', 'unknown-token', 'unreadable-pdf', 'validation-failed', 'write-failed',
  ]),
  errorKind: new Set(['expected', 'unexpected']),
  format: new Set(['docx', 'image', 'markdown', 'odt', 'pdf', 'txt']),
  imageQuality: new Set(['good', 'marginal', 'poor']),
  layerKind: new Set(['digital', 'scan-no-text', 'scan-with-text']),
  platform: new Set(['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32']),
  preset: new Set(['custom', 'lmstudio', 'mlx', 'ollama']),
  provider: new Set(['ollama', 'openai_compat']),
  redactionMode: new Set(['digital', 'flattened-scan']),
  safetyStatus: new Set(['complete', 'partial']),
  stage: new Set(['analysis', 'download', 'ipc', 'llm', 'model', 'ner', 'ocr', 'output', 'parser', 'session', 'settings']),
  status: new Set(['complete', 'done', 'error', 'failed', 'ok', 'partial', 'started']),
  verdict: new Set(['aligned', 'inconclusive', 'misaligned']),
}

const SAFE_ARRAY_VALUES = new Set([
  'analysis-page-error', 'ocr-page-error', 'entity-unmatched', 'entity-count-mismatch',
  'ambiguous-overlap', 'rejected-rectangle',
  ...SAFE_VALUES_BY_KEY.errorCode,
])
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export type PrivacyMetadataValue = string | number | boolean | null | readonly string[]
export type PrivacyMetadata = Readonly<Record<string, unknown>>
type SafeMetadata = Record<string, PrivacyMetadataValue>

/** Filtra sempre a runtime, anche quando il chiamante aggira accidentalmente i tipi. */
export function sanitizeLogMetadata(metadata?: PrivacyMetadata): SafeMetadata | undefined {
  if (!metadata) return undefined

  const safe: SafeMetadata = {}
  try {
    for (const [key, value] of Object.entries(metadata)) {
      if (NUMBER_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        safe[key] = value
      } else if (BOOLEAN_KEYS.has(key) && typeof value === 'boolean') {
        safe[key] = value
      } else if (
        typeof value === 'string'
        && (SAFE_VALUES_BY_KEY[key]?.has(value) || (key === 'version' && SAFE_VERSION.test(value)))
      ) {
        safe[key] = value
      } else if (
        TOKEN_ARRAY_KEYS.has(key)
        && Array.isArray(value)
        && value.every((item) => typeof item === 'string' && SAFE_ARRAY_VALUES.has(item))
      ) {
        safe[key] = value
      }
    }
  } catch {
    return undefined
  }
  return Object.keys(safe).length > 0 ? safe : undefined
}

const KNOWN_ERROR_CODES = new Set([
  'abort-error',
  'connection-refused',
  'connection-reset',
  'dns-failed',
  'entity-ledger-mismatch',
  'file-exists',
  'file-not-found',
  'network-timeout',
  'no-space',
  'ocr-artifact-missing',
  'ocr-failed',
  'ocr-unavailable',
  'permission-denied',
  'render-failed',
  'resource-limit',
  'source-changed',
  'token-owner-mismatch',
  'too-many-open-files',
  'unknown-token',
  'unreadable-pdf',
  'validation-failed',
  'write-failed',
])

const ERROR_CODE_ALIASES: Readonly<Record<string, string>> = {
  AbortError: 'abort-error',
  EACCES: 'permission-denied',
  EAI_AGAIN: 'dns-failed',
  ECONNREFUSED: 'connection-refused',
  ECONNRESET: 'connection-reset',
  EEXIST: 'file-exists',
  EMFILE: 'too-many-open-files',
  ENOENT: 'file-not-found',
  ENOSPC: 'no-space',
  ENOTFOUND: 'dns-failed',
  EPERM: 'permission-denied',
  ETIMEDOUT: 'network-timeout',
  TimeoutError: 'network-timeout',
}

/**
 * Restituisce soltanto codici noti. Non legge mai message, stack o cause e non
 * converte l'errore in stringa, perché ognuna di queste operazioni può includere
 * testo del documento, URL o percorsi locali.
 */
export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unexpected-error'

  try {
    const candidate = error as { code?: unknown; name?: unknown }
    if (typeof candidate.code === 'string') {
      const aliased = ERROR_CODE_ALIASES[candidate.code] ?? candidate.code
      if (KNOWN_ERROR_CODES.has(aliased)) return aliased
    }
    if (typeof candidate.name === 'string') {
      const aliased = ERROR_CODE_ALIASES[candidate.name]
      if (aliased) return aliased
    }
  } catch {
    return 'unexpected-error'
  }
  return 'unexpected-error'
}

function write(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  metadata?: PrivacyMetadata,
): void {
  const safe = sanitizeLogMetadata(metadata)
  if (safe) log[level](event, safe)
  else log[level](event)
}

interface PrivacyLogger {
  initialize(): void
  debug<const Event extends string>(event: LiteralString<Event>, metadata?: PrivacyMetadata): void
  info<const Event extends string>(event: LiteralString<Event>, metadata?: PrivacyMetadata): void
  warn<const Event extends string>(event: LiteralString<Event>, metadata?: PrivacyMetadata): void
  error<const Event extends string>(event: LiteralString<Event>, metadata?: PrivacyMetadata): void
}

export const privacyLog: PrivacyLogger = {
  initialize: () => log.initialize(),
  debug: (event, metadata) => write('debug', event, metadata),
  info: (event, metadata) => write('info', event, metadata),
  warn: (event, metadata) => write('warn', event, metadata),
  error: (event, metadata) => write('error', event, metadata),
}
