import React from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'

export default function ProcessingScreen(): React.JSX.Element {
  const { progressPercent, progressMessage, filePath, reset } = useSessionStore()
  const fileName = filePath?.split('/').pop() ?? ''

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-6">

        {/* Icona animata */}
        <div className="flex justify-center">
          <div className="relative">
            <ShieldCheck size={56} className="text-blue-600" />
            <Loader2
              size={24}
              className="absolute -bottom-1 -right-1 text-blue-400 animate-spin"
            />
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-1">
            Analisi in corso
          </h2>
          {fileName && (
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate max-w-xs mx-auto" title={fileName}>
              {fileName}
            </p>
          )}
        </div>

        {/* Barra progresso */}
        <div className="space-y-2">
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-2.5 bg-blue-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 min-h-[1.25rem]">
            {progressMessage}
          </p>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Il documento non lascia mai questo computer.
        </p>

        <button
          onClick={reset}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Annulla
        </button>
      </div>
    </div>
  )
}
