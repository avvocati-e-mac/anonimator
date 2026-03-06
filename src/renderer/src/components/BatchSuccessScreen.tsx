import React from 'react'
import { CheckCircle2, XCircle, FolderOpen, RotateCcw, RefreshCw, ShieldCheck } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'

export default function BatchSuccessScreen(): React.JSX.Element {
  const { batchResults, reset, resetBatchOnly, setError } = useSessionStore()

  const succeeded = batchResults.filter((r) => !r.error)
  const totalReplaced = succeeded.reduce((sum, r) => sum + (r.entitiesReplaced ?? 0), 0)

  const firstSuccess = succeeded[0]

  async function openFolder(): Promise<void> {
    if (!firstSuccess?.outputPath) return
    try {
      await window.electronAPI.showInFolder(firstSuccess.outputPath)
    } catch {
      setError('Impossibile aprire la cartella.')
    }
  }

  async function handleNewSession(): Promise<void> {
    await window.electronAPI.resetSession()
    reset()
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">

        {/* Icona e titolo */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center">
              <CheckCircle2 size={44} className="text-green-600 dark:text-green-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Anonimizzazione completata</h2>
          <p className="text-slate-500 dark:text-slate-400">
            {succeeded.length} file anonimizzati, {totalReplaced} entità sostituite in totale
          </p>
        </div>

        {/* Lista risultati per file */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
            {batchResults.map((result) => (
              <li key={result.filePath} className="flex items-start gap-3 px-4 py-3">
                {result.error ? (
                  <XCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate" title={result.fileName}>
                    {result.fileName}
                  </p>
                  {result.error ? (
                    <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
                  ) : (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      → {result.outputPath?.split('/').pop()}
                      {result.entitiesReplaced !== undefined && (
                        <span className="ml-1">({result.entitiesReplaced} sostituzioni)</span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Azioni */}
        <div className="flex flex-col gap-3">
          {firstSuccess?.outputPath && (
            <button
              onClick={openFolder}
              className="
                flex items-center justify-center gap-2
                w-full px-5 py-3 bg-blue-600 text-white font-medium rounded-xl
                hover:bg-blue-700 transition-colors
              "
            >
              <FolderOpen size={18} />
              Mostra cartella
            </button>
          )}
          <button
            onClick={resetBatchOnly}
            className="
              flex items-center justify-center gap-2
              w-full px-5 py-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium rounded-xl
              border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors
            "
          >
            <RotateCcw size={16} />
            Aggiungi altri documenti
          </button>
          <button
            onClick={handleNewSession}
            className="
              flex items-center justify-center gap-2
              w-full px-5 py-3 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium rounded-xl
              border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm
            "
          >
            <RefreshCw size={15} />
            Nuova sessione
          </button>
        </div>

        {/* Badge privacy */}
        <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1.5">
          <ShieldCheck size={13} className="text-green-500" />
          Nessun dato è stato inviato in rete
        </p>
      </div>
    </div>
  )
}
