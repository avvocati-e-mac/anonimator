import { createHash, randomBytes } from 'crypto'
import { createReadStream } from 'fs'
import { realpath, stat } from 'fs/promises'
import type {
  DetectedEntity,
  DocumentFormat,
  EntityDecision,
  EntityType,
  OcrLayerReport,
} from '@shared/types'

export interface SourceFingerprint {
  size: number
  mtimeMs: number
  sha256: string
}

export type PageSafetyKind = 'digital' | 'scan-aligned' | 'scan-untrusted' | 'page-error'

export interface PageSafetyReport {
  page: number
  kind: PageSafetyKind
}

export interface EntityLedgerEntry {
  entityId: string
  type: EntityType
  originalText: string
  expectedOccurrences: number | null
}

export interface AnalysisRegistration {
  ownerWebContentsId: number
  filePath: string
  format: DocumentFormat
  pageCount: number
  entities: DetectedEntity[]
  isScanned: boolean
  ocrReport?: OcrLayerReport
}

export interface AnalysisRecord {
  token: string
  ownerWebContentsId: number
  canonicalPath: string
  format: DocumentFormat
  fingerprint: SourceFingerprint
  pages: PageSafetyReport[]
  entityLedger: Map<string, EntityLedgerEntry>
  isScanned: boolean
  ocrReport?: OcrLayerReport
}

export class AnalysisTokenError extends Error {
  constructor(
    readonly code: 'unknown-token' | 'token-owner-mismatch' | 'source-changed' | 'entity-ledger-mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'AnalysisTokenError'
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', resolve)
  })
  return hash.digest('hex')
}

export async function fingerprintSource(filePath: string): Promise<{
  canonicalPath: string
  fingerprint: SourceFingerprint
}> {
  const canonicalPath = await realpath(filePath)
  const before = await stat(canonicalPath)
  if (!before.isFile()) throw new Error('La sorgente non è un file regolare.')
  const sha256 = await sha256File(canonicalPath)
  const after = await stat(canonicalPath)
  // Evita di registrare una fotografia incoerente se il file cambia durante l'hash.
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new AnalysisTokenError('source-changed', 'Il documento è cambiato durante l\'analisi.')
  }
  return {
    canonicalPath,
    fingerprint: { size: after.size, mtimeMs: after.mtimeMs, sha256 },
  }
}

function pageSafetyReport(input: AnalysisRegistration): PageSafetyReport[] {
  if (input.format !== 'pdf') {
    return Array.from({ length: input.pageCount }, (_, index) => ({ page: index + 1, kind: 'digital' }))
  }

  const measured = new Map(input.ocrReport?.pages.map((page) => [page.page, page]) ?? [])
  return Array.from({ length: input.pageCount }, (_, index) => {
    const page = index + 1
    if (!input.ocrReport) return { page, kind: 'page-error' as const }
    if (input.ocrReport.layerKind === 'digital') return { page, kind: 'digital' as const }
    const metric = measured.get(page)
    if (!metric || metric.reason === 'page-error') return { page, kind: 'page-error' as const }
    if (input.ocrReport.layerKind === 'scan-with-text' && metric.verdict === 'aligned') {
      return { page, kind: 'scan-aligned' as const }
    }
    return { page, kind: 'scan-untrusted' as const }
  })
}

function buildLedger(entities: DetectedEntity[]): Map<string, EntityLedgerEntry> {
  const ledger = new Map<string, EntityLedgerEntry>()
  for (const entity of entities) {
    if (ledger.has(entity.id)) throw new Error(`ID entità duplicato nell'analisi: ${entity.id}`)
    ledger.set(entity.id, {
      entityId: entity.id,
      type: entity.type,
      originalText: entity.originalText,
      expectedOccurrences: entity.occurrences,
    })
  }
  return ledger
}

function fingerprintsEqual(a: SourceFingerprint, b: SourceFingerprint): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256
}

/** Registro Main-only delle capability di analisi. Non serializza token o contenuto. */
export class AnalysisRegistry {
  private readonly records = new Map<string, AnalysisRecord>()

  async register(input: AnalysisRegistration): Promise<AnalysisRecord> {
    const { canonicalPath, fingerprint } = await fingerprintSource(input.filePath)
    this.invalidateForSource(input.ownerWebContentsId, canonicalPath)
    const token = randomBytes(32).toString('hex')
    const record: AnalysisRecord = {
      token,
      ownerWebContentsId: input.ownerWebContentsId,
      canonicalPath,
      format: input.format,
      fingerprint,
      pages: pageSafetyReport(input),
      entityLedger: buildLedger(input.entities),
      isScanned: input.isScanned,
      ocrReport: input.ocrReport,
    }
    this.records.set(token, record)
    return record
  }

  async invalidateForPath(ownerWebContentsId: number, filePath: string): Promise<void> {
    const canonicalPath = await realpath(filePath)
    this.invalidateForSource(ownerWebContentsId, canonicalPath)
  }

  private invalidateForSource(ownerWebContentsId: number, canonicalPath: string): void {
    for (const [token, record] of this.records) {
      if (record.ownerWebContentsId === ownerWebContentsId && record.canonicalPath === canonicalPath) {
        this.records.delete(token)
      }
    }
  }

  async resolveForSave(token: string, ownerWebContentsId: number): Promise<AnalysisRecord> {
    const record = this.records.get(token)
    if (!record) throw new AnalysisTokenError('unknown-token', 'Token di analisi non valido o scaduto.')
    if (record.ownerWebContentsId !== ownerWebContentsId) {
      throw new AnalysisTokenError('token-owner-mismatch', 'Il token appartiene a un\'altra finestra.')
    }

    let current: SourceFingerprint
    try {
      current = (await fingerprintSource(record.canonicalPath)).fingerprint
    } catch (error) {
      this.records.delete(token)
      if (error instanceof AnalysisTokenError) throw error
      throw new AnalysisTokenError('source-changed', 'Il documento sorgente non è più disponibile.')
    }
    if (!fingerprintsEqual(record.fingerprint, current)) {
      this.records.delete(token)
      throw new AnalysisTokenError('source-changed', 'Il documento sorgente è cambiato dopo l\'analisi.')
    }
    return record
  }

  validateDecisions(record: AnalysisRecord, decisions: EntityDecision[]): void {
    for (const decision of decisions) {
      const known = record.entityLedger.get(decision.entityId)
      // Gli ID non presenti sono entità manuali/importate: expectedOccurrences resta null.
      if (!known) continue
      if (known.type !== decision.type || known.originalText !== decision.originalText) {
        throw new AnalysisTokenError(
          'entity-ledger-mismatch',
          `L'entità ${decision.entityId} non corrisponde all'analisi registrata.`,
        )
      }
    }
  }

  release(token: string, ownerWebContentsId: number): boolean {
    const record = this.records.get(token)
    if (!record || record.ownerWebContentsId !== ownerWebContentsId) return false
    return this.records.delete(token)
  }

  releaseOwner(ownerWebContentsId: number): void {
    for (const [token, record] of this.records) {
      if (record.ownerWebContentsId === ownerWebContentsId) this.records.delete(token)
    }
  }

  clear(): void {
    this.records.clear()
  }

  size(): number {
    return this.records.size
  }
}

export const analysisRegistry = new AnalysisRegistry()
