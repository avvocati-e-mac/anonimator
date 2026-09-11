import { randomBytes } from 'crypto'
import type { Matrix as MupdfMatrix } from 'mupdf'
import type { Rect } from './geometry'

export const OCR_ARTIFACT_CACHE_MAX_BYTES = 128 * 1024 * 1024

export interface OcrArtifactWord {
  text: string
  bbox: Rect
  confidence: number
  line: number
  /** Pagina 1-based del documento sorgente. */
  page: number
}

export interface OcrPageArtifact {
  page: number
  words: OcrArtifactWord[]
  renderMatrix: MupdfMatrix
  pixmapOrigin: { x: number; y: number }
}

export interface OcrDocumentArtifact {
  pages: OcrPageArtifact[]
}

interface CacheEntry {
  artifact: OcrDocumentArtifact
  bytes: number
}

export class OcrArtifactCacheLimitError extends Error {
  readonly code = 'ocr-cache-limit'

  constructor(readonly requiredBytes: number, readonly availableBytes: number) {
    super(
      'Memoria OCR esaurita (limite 128 MiB). Completa o annulla i documenti aperti e riprova con un batch più piccolo.',
    )
    this.name = 'OcrArtifactCacheLimitError'
  }
}

/**
 * Stima stabile e indipendente dal motore JS. Non usa heapUsed: la stessa
 * sequenza di parole deve produrre la stessa decisione su tutte le piattaforme.
 */
export function estimateOcrArtifactBytes(artifact: OcrDocumentArtifact): number {
  let bytes = 64 // contenitore documento
  for (const page of artifact.pages) {
    bytes += 96 // pagina, matrice, origine e overhead collezione
    for (const word of page.words) {
      bytes += 96 + Buffer.byteLength(word.text, 'utf8')
    }
  }
  return bytes
}

/** Cache solo RAM. Tutti gli elementi legati a token sono attivi e non evictable. */
export class OcrArtifactCache {
  private readonly pending = new Map<string, CacheEntry>()
  private readonly active = new Map<string, CacheEntry>()
  private usedBytes = 0

  constructor(readonly maxBytes = OCR_ARTIFACT_CACHE_MAX_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes deve essere positivo')
  }

  stage(artifact: OcrDocumentArtifact): string {
    const bytes = estimateOcrArtifactBytes(artifact)
    const available = this.maxBytes - this.usedBytes
    if (bytes > available) throw new OcrArtifactCacheLimitError(bytes, available)
    const handle = randomBytes(16).toString('hex')
    this.pending.set(handle, { artifact, bytes })
    this.usedBytes += bytes
    return handle
  }

  bind(handle: string, analysisToken: string): void {
    const entry = this.pending.get(handle)
    if (!entry) throw new Error('Artefatto OCR provvisorio non disponibile.')
    if (this.active.has(analysisToken)) throw new Error('Il token ha già un artefatto OCR.')
    this.pending.delete(handle)
    this.active.set(analysisToken, entry)
  }

  discard(handle: string | undefined): void {
    if (!handle) return
    const entry = this.pending.get(handle)
    if (!entry) return
    this.pending.delete(handle)
    this.usedBytes -= entry.bytes
  }

  get(analysisToken: string): Readonly<OcrDocumentArtifact> | undefined {
    return this.active.get(analysisToken)?.artifact
  }

  release(analysisToken: string): boolean {
    const entry = this.active.get(analysisToken)
    if (!entry) return false
    this.active.delete(analysisToken)
    this.usedBytes -= entry.bytes
    return true
  }

  clear(): void {
    this.pending.clear()
    this.active.clear()
    this.usedBytes = 0
  }

  stats(): { active: number; pending: number; usedBytes: number; maxBytes: number } {
    return {
      active: this.active.size,
      pending: this.pending.size,
      usedBytes: this.usedBytes,
      maxBytes: this.maxBytes,
    }
  }
}

export const ocrArtifactCache = new OcrArtifactCache()

/** Getter Main-only destinato al generatore PDF v1.7. */
export function getOcrArtifact(analysisToken: string): Readonly<OcrDocumentArtifact> | undefined {
  return ocrArtifactCache.get(analysisToken)
}
