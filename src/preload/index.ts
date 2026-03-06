import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import type { AnonymizeRequest, LlmConfig, BatchAnonymizeRequest } from '@shared/types'

// Espone all'interfaccia grafica SOLO le funzioni strettamente necessarie.
// Il renderer non può fare nient'altro — non vede Node.js, non vede il filesystem.
contextBridge.exposeInMainWorld('electronAPI', {
  // Invia un file al backend per l'analisi NER
  processDocument: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOC_PROCESS, { filePath }),

  // Invia le entità confermate per l'anonimizzazione
  anonymizeDocument: (request: AnonymizeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOC_ANONYMIZE, request),

  // Anonimizza N file in batch
  batchAnonymize: (requests: BatchAnonymizeRequest[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.BATCH_ANONYMIZE, requests),

  // Resetta il dizionario pseudonimi della sessione corrente
  resetSession: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_RESET),

  // Ascolta aggiornamenti di avanzamento (emessi dal Main durante il processing)
  onProgress: (callback: (progress: { stage: string; percent: number; message: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DOC_PROGRESS, (_event, data) => callback(data))
    // Restituisce una funzione per rimuovere il listener (evita memory leak)
    return () => ipcRenderer.removeAllListeners(IPC_CHANNELS.DOC_PROGRESS)
  },

  // Apre la cartella del file output nel Finder/Explorer (gestito dal main process)
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),

  // Restituisce il path assoluto di un File droppato (Electron 32+)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Versione app (letta dal main process via IPC — app non è disponibile nel preload sandboxed)
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  // Settings: ottieni configurazione corrente
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

  // Settings: salva configurazione
  setSettings: (settings: { llm: LlmConfig }) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),

  // LLM: testa connessione con la configurazione fornita
  testLlm: (llm: LlmConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_TEST, { llm }),

  // LLM: elenca modelli disponibili sul server
  listLlmModels: (baseUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_LIST_MODELS, { baseUrl, timeoutMs: 10000 })
})
