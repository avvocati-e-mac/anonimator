import { useState, useCallback } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { mergeEntities } from '../utils/entityUtils'
import type { BatchFileItem } from '@shared/types'

interface ErrorDialogState {
  file: BatchFileItem
  resolve: (action: 'retry' | 'skip') => void
}

export interface UseBatchOrchestratorReturn {
  startBatchAnalysis: (files: BatchFileItem[]) => Promise<void>
  errorDialog: ErrorDialogState | null
  resolveErrorDialog: (action: 'retry' | 'skip') => void
}

export function useBatchOrchestrator(): UseBatchOrchestratorReturn {
  const {
    setBatchFiles,
    updateBatchFile,
    setMergedEntities,
    setScreen,
    setProgress,
    setBatchCurrentFileIndex,
  } = useSessionStore()

  const [errorDialog, setErrorDialog] = useState<ErrorDialogState | null>(null)

  function resolveErrorDialog(action: 'retry' | 'skip'): void {
    errorDialog?.resolve(action)
    setErrorDialog(null)
  }

  const startBatchAnalysis = useCallback(
    async (files: BatchFileItem[]): Promise<void> => {
      setBatchFiles(files)
      setScreen('batch-processing')

      const completedResults: import('@shared/types').DocumentAnalysisResult[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setBatchCurrentFileIndex(i + 1)
        updateBatchFile(file.filePath, { status: 'analyzing' })
        setProgress(0, `Analisi ${i + 1}/${files.length}: ${file.fileName}...`)

        let success = false
        while (!success) {
          try {
            const result = await window.electronAPI.processDocument(file.filePath)

            if ('error' in result && result.error) {
              // Chiede all'utente riprova o salta
              const action = await new Promise<'retry' | 'skip'>((resolve) => {
                setErrorDialog({ file, resolve })
              })
              if (action === 'skip') {
                updateBatchFile(file.filePath, {
                  status: 'error',
                  error: String(result.error),
                })
                success = true // esce dal while, salta questo file
              }
              // se 'retry', il while continua
            } else {
              const analysisResult = result as import('@shared/types').DocumentAnalysisResult
              updateBatchFile(file.filePath, { status: 'done', analysisResult })
              completedResults.push(analysisResult)
              success = true
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Errore sconosciuto'
            const action = await new Promise<'retry' | 'skip'>((resolve) => {
              setErrorDialog({ file: { ...file, error: message }, resolve })
            })
            if (action === 'skip') {
              updateBatchFile(file.filePath, { status: 'error', error: message })
              success = true
            }
          }
        }
      }

      const merged = mergeEntities(completedResults)
      setMergedEntities(merged)
      setScreen('batch-review')
    },
    [setBatchFiles, updateBatchFile, setMergedEntities, setScreen, setProgress, setBatchCurrentFileIndex]
  )

  return { startBatchAnalysis, errorDialog, resolveErrorDialog }
}
