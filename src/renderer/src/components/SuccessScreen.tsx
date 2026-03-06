import React from 'react'
import { CheckCircle2, FolderOpen, RotateCcw, ShieldCheck } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'

export default function SuccessScreen(): React.JSX.Element {
  const { successInfo, reset, setError } = useSessionStore()

  if (!successInfo) return <></>

  const { outputPath, entitiesReplaced, fileName } = successInfo
  const outputName = outputPath.split('/').pop() ?? outputPath

  async function openOutputFolder(): Promise<void> {
    try {
      await window.electronAPI.showInFolder(outputPath)
    } catch {
      setError('Impossibile aprire la cartella.')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-6">

        {/* Icona successo */}
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center">
            <CheckCircle2 size={44} className="text-green-600 dark:text-green-400" />
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            Documento anonimizzato
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {entitiesReplaced} entit{entitiesReplaced === 1 ? 'à sostituita' : 'à sostituite'} in
          </p>
          <p className="text-slate-700 dark:text-slate-300 font-medium mt-1 truncate" title={fileName}>
            {fileName}
          </p>
        </div>

        {/* File di output */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-left">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">File salvato come</p>
          <p className="text-sm font-mono text-slate-700 dark:text-slate-300 break-all" title={outputPath}>
            {outputName}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 break-all">
            nella stessa cartella del documento originale
          </p>
        </div>

        {/* Azioni */}
        <div className="flex flex-col gap-3">
          <button
            onClick={openOutputFolder}
            className="
              flex items-center justify-center gap-2
              w-full px-5 py-3 bg-blue-600 text-white font-medium rounded-xl
              hover:bg-blue-700 transition-colors
            "
          >
            <FolderOpen size={18} />
            Mostra nella cartella
          </button>
          <button
            onClick={reset}
            className="
              flex items-center justify-center gap-2
              w-full px-5 py-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium rounded-xl
              border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors
            "
          >
            <RotateCcw size={16} />
            Anonimizza un altro documento
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
