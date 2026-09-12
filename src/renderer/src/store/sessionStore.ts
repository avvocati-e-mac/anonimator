import { create } from 'zustand'
import type {
  DetectedEntity, DocumentAnalysisResult, BatchFileItem, BatchResultItem, EntityType,
  EntityRedactionOutcome, PartialReason, RedactionMode, ProcessingProgress
} from '@shared/types'
import type { MergedEntity as ReferencedMergedEntity } from '../utils/entityUtils'

// Entità con campo aggiuntivo per il batch (quanti file la contengono)
export type MergedEntity = ReferencedMergedEntity

export type BatchUiResult = BatchResultItem & {
  safetyStatus?: 'complete' | 'partial'
  partialReasons?: PartialReason[]
  outcomes?: EntityRedactionOutcome[]
  redactionMode?: RedactionMode
}

// Le schermate dell'app (singolo + batch)
export type AppScreen =
  | 'dropzone'
  | 'processing'
  | 'review'
  | 'success'
  | 'batch-processing'
  | 'batch-review'
  | 'batch-success'

export interface SuccessInfo {
  outputPath: string
  entitiesReplaced: number
  fileName: string
  /** Quanto è cresciuto il file rispetto all'originale. */
  sizeRatio?: number
  sizeWarning?: boolean
  safetyStatus: 'complete' | 'partial'
  partialReasons: PartialReason[]
  outcomes: EntityRedactionOutcome[]
  redactionMode: RedactionMode
}

export interface SessionStats {
  totalFiles: number
  totalPages: number
  elapsedMs: number
}

interface SessionState {
  // Navigazione
  screen: AppScreen

  // ── Singolo file ──────────────────────────────────────────────────────────
  filePath: string | null
  analysisResult: DocumentAnalysisResult | null
  progressPercent: number
  progressMessage: string
  progressStage: ProcessingProgress['stage']
  entities: DetectedEntity[]
  successInfo: SuccessInfo | null

  // ── Batch ─────────────────────────────────────────────────────────────────
  batchFiles: BatchFileItem[]
  batchCurrentFileIndex: number
  mergedEntities: MergedEntity[]
  batchResults: BatchUiResult[]

  // Statistiche di sessione (visibili nelle schermate di successo)
  processingStartedAt: number | null
  sessionStats: SessionStats | null

  // Errore (overlay su qualunque schermata)
  error: string | null

  // ── Azioni singolo file ───────────────────────────────────────────────────
  setScreen: (screen: AppScreen) => void
  setFilePath: (path: string) => void
  setAnalysisResult: (result: DocumentAnalysisResult) => void
  setProgress: (percent: number, message: string, stage: ProcessingProgress['stage']) => void
  toggleEntityConfirmed: (id: string) => void
  updateEntityPseudonym: (id: string, pseudonym: string) => void
  updateEntityType: (id: string, type: EntityType) => void
  updateEntityOriginalText: (id: string, originalText: string) => void
  setSuccessInfo: (info: SuccessInfo) => void
  setError: (error: string | null) => void

  // ── Azioni batch ──────────────────────────────────────────────────────────
  setBatchFiles: (files: BatchFileItem[]) => void
  updateBatchFile: (filePath: string, patch: Partial<BatchFileItem>) => void
  setBatchCurrentFileIndex: (index: number) => void
  setMergedEntities: (entities: MergedEntity[]) => void
  toggleMergedEntityConfirmed: (id: string) => void
  updateMergedEntityPseudonym: (id: string, pseudonym: string) => void
  updateMergedEntityType: (id: string, type: EntityType) => void
  updateMergedEntityOriginalText: (id: string, originalText: string) => void
  setBatchResults: (results: BatchUiResult[]) => void

  setProcessingStartedAt: (ts: number) => void
  setSessionStats: (stats: SessionStats) => void

  addEntity: (entity: DetectedEntity) => void
  addMergedEntity: (entity: MergedEntity) => void
  importEntitiesToSingle: (imported: DetectedEntity[]) => void
  importEntitiesToBatch: (imported: MergedEntity[]) => void
  setFilePathAndMerge: (filePath: string, result: DocumentAnalysisResult) => void

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset: () => void
  resetBatchOnly: () => void
}

const initialState = {
  screen: 'dropzone' as AppScreen,
  filePath: null,
  analysisResult: null,
  progressPercent: 0,
  progressMessage: '',
  progressStage: 'parsing' as ProcessingProgress['stage'],
  entities: [],
  successInfo: null,
  batchFiles: [],
  batchCurrentFileIndex: 0,
  mergedEntities: [],
  batchResults: [],
  processingStartedAt: null,
  sessionStats: null,
  error: null,
}

function releaseActiveTokens(state: Pick<SessionState, 'analysisResult' | 'batchFiles'>): void {
  const tokens = new Set<string>()
  if (state.analysisResult?.analysisToken) tokens.add(state.analysisResult.analysisToken)
  for (const file of state.batchFiles) {
    if (file.analysisResult?.analysisToken) tokens.add(file.analysisResult.analysisToken)
  }
  for (const token of tokens) void window.electronAPI.releaseAnalysis(token)
}

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  // ── Singolo file ──────────────────────────────────────────────────────────
  setScreen: (screen) => set({ screen }),
  setFilePath: (filePath) => set({ filePath }),
  setAnalysisResult: (result) => set({ analysisResult: result, entities: result.entities }),
  setProgress: (progressPercent, progressMessage, progressStage) =>
    set({ progressPercent, progressMessage, progressStage }),

  toggleEntityConfirmed: (id) =>
    set((state) => ({
      entities: state.entities.map((e) =>
        e.id === id ? { ...e, confirmed: !e.confirmed } : e
      ),
    })),

  updateEntityPseudonym: (id, pseudonym) =>
    set((state) => ({
      entities: state.entities.map((e) =>
        e.id === id ? { ...e, pseudonym } : e
      ),
    })),

  updateEntityType: (id, type) =>
    set((state) => ({
      entities: state.entities.map((e) =>
        e.id === id ? { ...e, type } : e
      ),
    })),

  updateEntityOriginalText: (id, originalText) =>
    set((state) => ({
      entities: state.entities.map((e) =>
        e.id === id ? { ...e, originalText } : e
      ),
    })),

  setSuccessInfo: (successInfo) => set({ successInfo }),
  setError: (error) => set({ error }),

  // ── Batch ─────────────────────────────────────────────────────────────────
  setBatchFiles: (batchFiles) => set({ batchFiles }),

  updateBatchFile: (filePath, patch) =>
    set((state) => ({
      batchFiles: state.batchFiles.map((f) =>
        f.filePath === filePath ? { ...f, ...patch } : f
      ),
    })),

  setBatchCurrentFileIndex: (batchCurrentFileIndex) => set({ batchCurrentFileIndex }),
  setMergedEntities: (mergedEntities) => set({ mergedEntities }),

  toggleMergedEntityConfirmed: (id) =>
    set((state) => ({
      mergedEntities: state.mergedEntities.map((e) =>
        e.id === id ? { ...e, confirmed: !e.confirmed } : e
      ),
    })),

  updateMergedEntityPseudonym: (id, pseudonym) =>
    set((state) => ({
      mergedEntities: state.mergedEntities.map((e) =>
        e.id === id ? { ...e, pseudonym } : e
      ),
    })),

  updateMergedEntityType: (id, type) =>
    set((state) => ({
      mergedEntities: state.mergedEntities.map((e) =>
        e.id === id ? { ...e, type } : e
      ),
    })),

  updateMergedEntityOriginalText: (id, originalText) =>
    set((state) => ({
      mergedEntities: state.mergedEntities.map((e) =>
        e.id === id ? { ...e, originalText } : e
      ),
    })),

  setBatchResults: (batchResults) => set({ batchResults }),

  setProcessingStartedAt: (ts) => set({ processingStartedAt: ts }),
  setSessionStats: (sessionStats) => set({ sessionStats }),

  addEntity: (entity) => set((state) => ({ entities: [...state.entities, entity] })),

  addMergedEntity: (entity) => set((state) => ({ mergedEntities: [...state.mergedEntities, entity] })),

  importEntitiesToSingle: (imported) =>
    set((state) => {
      const map = new Map(state.entities.map((e) => [e.originalText.toLowerCase(), e]))
      for (const imp of imported) {
        const key = imp.originalText.toLowerCase()
        if (map.has(key)) {
          map.set(key, { ...map.get(key)!, pseudonym: imp.pseudonym })
        } else {
          map.set(key, imp)
        }
      }
      return { entities: Array.from(map.values()) }
    }),

  importEntitiesToBatch: (imported) =>
    set((state) => {
      const map = new Map(state.mergedEntities.map((e) => [e.originalText.toLowerCase(), e]))
      for (const imp of imported) {
        const key = imp.originalText.toLowerCase()
        if (map.has(key)) {
          map.set(key, { ...map.get(key)!, pseudonym: imp.pseudonym, applyToAll: true })
        } else {
          map.set(key, { ...imp, references: [], applyToAll: true })
        }
      }
      return { mergedEntities: Array.from(map.values()) }
    }),

  setFilePathAndMerge: (filePath, result) =>
    set((state) => {
      const map = new Map(state.entities.map((e) => [e.originalText.toLowerCase(), e]))
      for (const e of result.entities) {
        const key = e.originalText.toLowerCase()
        if (!map.has(key)) map.set(key, e)
      }
      const entities = Array.from(map.values())
      return { filePath, entities, analysisResult: { ...result, entities } }
    }),

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset: () => set((state) => {
    releaseActiveTokens(state)
    return initialState
  }),

  // Torna alla dropzone mantenendo la sessione NER (pseudonimi già assegnati)
  resetBatchOnly: () =>
    set((state) => {
      releaseActiveTokens(state)
      return {
      screen: 'dropzone',
      batchFiles: [],
      batchCurrentFileIndex: 0,
      mergedEntities: [],
      batchResults: [],
      progressPercent: 0,
      progressMessage: '',
      error: null,
      }
    }),
}))
