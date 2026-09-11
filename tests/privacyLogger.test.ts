import { beforeEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('electron-log', () => ({ default: logMock }))

import {
  privacyLog,
  safeErrorCode,
  sanitizeLogMetadata,
} from '../src/main/services/privacyLogger'

const CANARY = 'PERSONA_SINTETICA_PRIVACY_CANARY'
const PATH_CANARY = `/Users/${CANARY}/Pratica ${CANARY}/atto.pdf`

describe('privacyLogger', () => {
  beforeEach(() => vi.clearAllMocks())

  it('conserva solo metadati esplicitamente consentiti', () => {
    expect(sanitizeLogMetadata({
      format: 'pdf',
      pageCount: 3,
      llmUsed: false,
      partialReasons: ['entity-unmatched'],
      filePath: PATH_CANARY,
      outputPath: PATH_CANARY,
      fileName: `${CANARY}.pdf`,
      content: CANARY,
      pseudonym: CANARY,
      model: CANARY,
      url: `http://${CANARY}.invalid`,
      nested: { value: CANARY },
    })).toEqual({
      format: 'pdf',
      pageCount: 3,
      llmUsed: false,
      partialReasons: ['entity-unmatched'],
    })
  })

  it('scarta valori non validi anche sotto una chiave consentita', () => {
    expect(sanitizeLogMetadata({
      code: CANARY,
      pageCount: Number.NaN,
      enabled: 'true',
      partialReasons: ['entity-unmatched', `reason-${CANARY}`],
    })).toBeUndefined()
  })

  it('non inoltra canary o oggetti Error al backend di log', () => {
    privacyLog.error('document-processing-failed', {
      stage: 'ocr',
      errorCode: safeErrorCode(new Error(CANARY)),
      message: CANARY,
      stack: PATH_CANARY,
      cause: { content: CANARY },
    })

    expect(logMock.error).toHaveBeenCalledWith('document-processing-failed', {
      stage: 'ocr',
      errorCode: 'unexpected-error',
    })
    expect(JSON.stringify(logMock.error.mock.calls)).not.toContain(CANARY)
  })

  it('traduce solo codici errore noti senza leggere message, stack o cause', () => {
    const tainted = {
      code: 'ENOENT',
      name: 'Error',
      message: CANARY,
      stack: PATH_CANARY,
      cause: new Error(CANARY),
    }
    expect(safeErrorCode(tainted)).toBe('file-not-found')
    expect(safeErrorCode({ code: 'ocr-artifact-missing', message: CANARY })).toBe('ocr-artifact-missing')
    expect(safeErrorCode({ code: CANARY, message: CANARY })).toBe('unexpected-error')
    expect(safeErrorCode(CANARY)).toBe('unexpected-error')
  })

  it('non aggiunge un oggetto vuoto quando tutti i metadati sono rifiutati', () => {
    privacyLog.warn('unsafe-metadata-dropped', { content: CANARY, path: PATH_CANARY })
    expect(logMock.warn).toHaveBeenCalledWith('unsafe-metadata-dropped')
  })

  it('resta fail-closed anche con getter ostili', () => {
    const hostileMetadata = Object.defineProperty({}, 'content', {
      enumerable: true,
      get: () => { throw new Error(CANARY) },
    })
    const hostileError = Object.defineProperty({}, 'code', {
      get: () => { throw new Error(CANARY) },
    })

    expect(sanitizeLogMetadata(hostileMetadata)).toBeUndefined()
    expect(safeErrorCode(hostileError)).toBe('unexpected-error')
  })
})
