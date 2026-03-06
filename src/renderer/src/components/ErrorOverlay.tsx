import React from 'react'
import { AlertCircle, X } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'

export default function ErrorOverlay(): React.JSX.Element | null {
  const { error, setError } = useSessionStore()
  if (!error) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={24} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Errore</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 flex-shrink-0"
            aria-label="Chiudi"
          >
            <X size={18} />
          </button>
        </div>
        <button
          onClick={() => setError(null)}
          className="w-full py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg transition-colors"
        >
          Chiudi
        </button>
      </div>
    </div>
  )
}
