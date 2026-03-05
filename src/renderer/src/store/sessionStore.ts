import { create } from 'zustand'
import type { DetectedEntity, DocumentAnalysisResult } from '@shared/types'

// Le 4 schermate dell'app
export type AppScreen = 'dropzone' | 'processing' | 'review' | 'success'

export interface SuccessInfo {
  outputPath: string
  entitiesReplaced: number
  fileName: string
}

interface SessionState {
  // Navigazione
  screen: AppScreen

  // File corrente
  filePath: string | null
  analysisResult: DocumentAnalysisResult | null

  // Progresso elaborazione
  progressPercent: number
  progressMessage: string

  // Entità modificabili dall'utente nella schermata di revisione
  entities: DetectedEntity[]

  // Risultato finale
  successInfo: SuccessInfo | null

  // Errore (mostrato in overlay su qualunque schermata)
  error: string | null

  // Azioni
  setScreen: (screen: AppScreen) => void
  setFilePath: (path: string) => void
  setAnalysisResult: (result: DocumentAnalysisResult) => void
  setProgress: (percent: number, message: string) => void
  toggleEntityConfirmed: (id: string) => void
  updateEntityPseudonym: (id: string, pseudonym: string) => void
  setSuccessInfo: (info: SuccessInfo) => void
  setError: (error: string | null) => void
  reset: () => void
}

const initialState = {
  screen: 'dropzone' as AppScreen,
  filePath: null,
  analysisResult: null,
  progressPercent: 0,
  progressMessage: '',
  entities: [],
  successInfo: null,
  error: null,
}

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setScreen: (screen) => set({ screen }),

  setFilePath: (filePath) => set({ filePath }),

  setAnalysisResult: (result) =>
    set({ analysisResult: result, entities: result.entities }),

  setProgress: (progressPercent, progressMessage) =>
    set({ progressPercent, progressMessage }),

  // Inverte il flag confirmed di una singola entità (l'utente spunta/deseleziona)
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

  // Torna allo stato iniziale per elaborare un nuovo documento
  reset: () => set(initialState),
}))
