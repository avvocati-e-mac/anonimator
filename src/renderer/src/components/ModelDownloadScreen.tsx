import React, { useEffect, useState, useCallback } from 'react'
import { Download, Loader2, AlertCircle, CheckCircle } from 'lucide-react'

type Status = 'downloading' | 'done' | 'error'

interface Props {
  onComplete: () => void
}

export default function ModelDownloadScreen({ onComplete }: Props): React.JSX.Element {
  const [percent, setPercent] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [status, setStatus] = useState<Status>('downloading')
  const [errorMsg, setErrorMsg] = useState('')

  const startDownload = useCallback(() => {
    setStatus('downloading')
    setPercent(0)
    setErrorMsg('')
    window.electronAPI.downloadModel().then((res: { ok: boolean; error?: string }) => {
      if (!res.ok) {
        setStatus('error')
        setErrorMsg(res.error ?? 'Errore sconosciuto')
      }
    }).catch((err: Error) => {
      setStatus('error')
      setErrorMsg(err.message)
    })
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onModelDownloadProgress((data) => {
      setPercent(data.percent)
      if (data.file) setCurrentFile(data.file)
      if (data.done && !data.error) {
        setStatus('done')
        setTimeout(onComplete, 800)
      }
      if (data.error) {
        setStatus('error')
        setErrorMsg(data.error)
      }
    })
    startDownload()
    return unsub
  }, [onComplete, startDownload])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-6">

        {/* Icona */}
        <div className="flex justify-center">
          {status === 'downloading' && (
            <div className="relative">
              <Download size={56} className="text-blue-600" />
              <Loader2 size={24} className="absolute -bottom-1 -right-1 text-blue-400 animate-spin" />
            </div>
          )}
          {status === 'done' && <CheckCircle size={56} className="text-green-500" />}
          {status === 'error' && <AlertCircle size={56} className="text-red-500" />}
        </div>

        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-1">
            {status === 'downloading' && 'Download modelli linguistici'}
            {status === 'done' && 'Download completato'}
            {status === 'error' && 'Errore durante il download'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {status === 'downloading' && 'Necessario solo al primo avvio (~80 MB)'}
            {status === 'done' && 'Tutto pronto, avvio in corso...'}
            {status === 'error' && errorMsg}
          </p>
        </div>

        {/* Barra progresso */}
        {status === 'downloading' && (
          <div className="space-y-2">
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 bg-blue-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 min-h-[1.25rem]">
              {currentFile ? `${currentFile} — ${percent}%` : `${percent}%`}
            </p>
          </div>
        )}

        {/* Retry */}
        {status === 'error' && (
          <button
            onClick={startDownload}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Riprova
          </button>
        )}
      </div>
    </div>
  )
}
