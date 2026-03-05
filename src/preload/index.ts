import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import type { AnonymizeRequest } from '@shared/types'

// Espone all'interfaccia grafica SOLO le funzioni strettamente necessarie.
// Il renderer non può fare nient'altro — non vede Node.js, non vede il filesystem.
contextBridge.exposeInMainWorld('electronAPI', {
  // Invia un file al backend per l'analisi NER
  processDocument: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOC_PROCESS, { filePath }),

  // Invia le entità confermate per l'anonimizzazione
  anonymizeDocument: (request: AnonymizeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOC_ANONYMIZE, request),

  // Resetta il dizionario pseudonimi della sessione corrente
  resetSession: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_RESET),

  // Ascolta aggiornamenti di avanzamento (emessi dal Main durante il processing)
  onProgress: (callback: (progress: { stage: string; percent: number; message: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DOC_PROGRESS, (_event, data) => callback(data))
    // Restituisce una funzione per rimuovere il listener (evita memory leak)
    return () => ipcRenderer.removeAllListeners(IPC_CHANNELS.DOC_PROGRESS)
  }
})
