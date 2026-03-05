/// <reference types="vite/client" />

import type { AnonymizeRequest, SaveResult, DocumentAnalysisResult } from '@shared/types'

// Tipizzazione dell'API esposta dal preload via contextBridge
interface ElectronAPI {
  processDocument: (filePath: string) => Promise<{ error?: unknown } | DocumentAnalysisResult>
  anonymizeDocument: (request: AnonymizeRequest) => Promise<{ error?: unknown } | SaveResult>
  resetSession: () => Promise<{ status: string }>
  onProgress: (
    callback: (progress: { stage: string; percent: number; message: string }) => void
  ) => () => void
  showInFolder: (filePath: string) => void
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
