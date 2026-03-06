import { create } from 'zustand'
import type { DetectedEntity, DocumentAnalysisResult, BatchFileItem, BatchResultItem } from '@shared/types'

// Entità con campo aggiuntivo per il batch (quanti file la contengono)
export interface MergedEntity extends DetectedEntity {
  fileCount?: number
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
}

interface SessionState {
  // Navigazione
  screen: AppScreen

  // ── Singolo file ──────────────────────────────────────────────────────────
  filePath: string | null
  analysisResult: DocumentAnalysisResult | null
  progressPercent: number
  progressMessage: string
  entities: DetectedEntity[]
  successInfo: SuccessInfo | null

  // ── Batch ─────────────────────────────────────────────────────────────────
  batchFiles: BatchFileItem[]
  batchCurrentFileIndex: number
  mergedEntities: MergedEntity[]
  batchResults: BatchResultItem[]

  // Errore (overlay su qualunque schermata)
  error: string | null

  // ── Azioni singolo file ───────────────────────────────────────────────────
  setScreen: (screen: AppScreen) => void
  setFilePath: (path: string) => void
  setAnalysisResult: (result: DocumentAnalysisResult) => void
  setProgress: (percent: number, message: string) => void
  toggleEntityConfirmed: (id: string) => void
  updateEntityPseudonym: (id: string, pseudonym: string) => void
  setSuccessInfo: (info: SuccessInfo) => void
  setError: (error: string | null) => void

  // ── Azioni batch ──────────────────────────────────────────────────────────
  setBatchFiles: (files: BatchFileItem[]) => void
  updateBatchFile: (filePath: string, patch: Partial<BatchFileItem>) => void
  setBatchCurrentFileIndex: (index: number) => void
  setMergedEntities: (entities: MergedEntity[]) => void
  toggleMergedEntityConfirmed: (id: string) => void
  updateMergedEntityPseudonym: (id: string, pseudonym: string) => void
  setBatchResults: (results: BatchResultItem[]) => void

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
  entities: [],
  successInfo: null,
  batchFiles: [],
  batchCurrentFileIndex: 0,
  mergedEntities: [],
  batchResults: [],
  error: null,
}

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  // ── Singolo file ──────────────────────────────────────────────────────────
  setScreen: (screen) => set({ screen }),
  setFilePath: (filePath) => set({ filePath }),
  setAnalysisResult: (result) => set({ analysisResult: result, entities: result.entities }),
  setProgress: (progressPercent, progressMessage) => set({ progressPercent, progressMessage }),

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

  setBatchResults: (batchResults) => set({ batchResults }),

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset: () => set(initialState),

  // Torna alla dropzone mantenendo la sessione NER (pseudonimi già assegnati)
  resetBatchOnly: () =>
    set({
      screen: 'dropzone',
      batchFiles: [],
      batchCurrentFileIndex: 0,
      mergedEntities: [],
      batchResults: [],
      progressPercent: 0,
      progressMessage: '',
      error: null,
    }),
}))
