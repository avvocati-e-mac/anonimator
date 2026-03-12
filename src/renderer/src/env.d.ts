/// <reference types="vite/client" />

import type { AnonymizeRequest, SaveResult, DocumentAnalysisResult, LlmConfig, BatchAnonymizeRequest, BatchResultItem, DetectedEntity, EntityType, ModelStatus, ModelDownloadProgress } from '@shared/types'

// Tipizzazione dell'API esposta dal preload via contextBridge
interface ElectronAPI {
  processDocument: (filePath: string) => Promise<{ error?: unknown } | DocumentAnalysisResult>
  anonymizeDocument: (request: AnonymizeRequest) => Promise<{ error?: unknown } | SaveResult>
  batchAnonymize: (requests: BatchAnonymizeRequest[]) => Promise<BatchResultItem[]>
  resetSession: () => Promise<{ status: string }>
  onProgress: (
    callback: (progress: { stage: string; percent: number; message: string }) => void
  ) => () => void
  showInFolder: (filePath: string) => void
  getPathForFile: (file: File) => string
  getSettings: () => Promise<{ llm: LlmConfig }>
  setSettings: (settings: { llm: LlmConfig }) => Promise<{ status: string } | { error: string }>
  testLlm: (llm: LlmConfig) => Promise<import('@shared/types').LlmTestResult>
  listLlmModels: (llm: LlmConfig) => Promise<{ models: string[] }>
  getDefaultPrompt: (lang: 'it' | 'en') => Promise<string>
  getAppVersion: () => Promise<string>
  addEntity: (originalText: string, type: string) => Promise<{ pseudonym: string; id: string } | { error: string }>
  exportEntities: (entities: Array<{ originalText: string; pseudonym: string; type: string }>, defaultFileName?: string) => Promise<{ saved: true } | { cancelled: true } | { error: string }>
  importEntities: () => Promise<{ imported: number; entries: Array<{ originalText: string; pseudonym: string; type: string; id: string }> } | { cancelled: true } | { error: string }>
  saveSession: () => Promise<{ status: string } | { error: string }>
  loadSession: () => Promise<{ entities: DetectedEntity[] } | null>
  hasSavedSession: () => Promise<{ exists: boolean }>
  deleteSession: () => Promise<{ status: string } | { error: string }>
  getSessionPath: () => Promise<{ path: string }>
  collectDiagnostics: () => Promise<string>
  getModelStatus: () => Promise<ModelStatus>
  downloadModel: () => Promise<{ ok: boolean; error?: string }>
  onModelDownloadProgress: (cb: (data: ModelDownloadProgress) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
