import React, { useCallback, useEffect, useState, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { ShieldCheck, Upload, FileText, Settings } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { useBatchOrchestrator } from '../hooks/useBatchOrchestrator'
import type { BatchFileItem } from '@shared/types'

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.odt', '.txt', '.png', '.jpg', '.jpeg']
const ACCEPTED_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'text/plain': ['.txt'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
}

interface DropZoneProps {
  onOpenSettings: () => void
}

export default function DropZone({ onOpenSettings }: DropZoneProps): React.JSX.Element {
  const { setFilePath, setScreen, setProgress, setAnalysisResult, setError } = useSessionStore()
  const { startBatchAnalysis, errorDialog, resolveErrorDialog } = useBatchOrchestrator()
  const [version, setVersion] = useState('')
  // Salva i path estratti dall'evento drop nativo prima che react-dropzone cloni i File objects
  const nativeDropPathsRef = useRef<string[]>([])

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion)
  }, [])

  // Intercetta il drop nativo (capture phase) per ottenere i path assoluti
  // tramite webUtils.getPathForFile prima che react-dropzone processi i file
  useEffect(() => {
    const handleNativeDrop = (e: DragEvent): void => {
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        nativeDropPathsRef.current = Array.from(files)
          .map((f) => window.electronAPI.getPathForFile(f))
          .filter(Boolean)
      }
    }
    window.addEventListener('drop', handleNativeDrop, true)
    return () => window.removeEventListener('drop', handleNativeDrop, true)
  }, [])

  const onDrop = useCallback(
    async (accepted: File[]): Promise<void> => {
      if (accepted.length === 0) return

      // Recupera i path dal ref (catturati prima che react-dropzone clonasse i File)
      const nativePaths = nativeDropPathsRef.current
      nativeDropPathsRef.current = []

      const paths: string[] = accepted.map((file, i) => {
        return nativePaths[i] || window.electronAPI.getPathForFile(file) || ''
      }).filter(Boolean)

      if (paths.length === 0) {
        setError('Impossibile leggere il percorso dei file. Riprova.')
        return
      }

      // ── File singolo: flusso originale ──────────────────────────────────
      if (paths.length === 1) {
        const filePath = paths[0]
        setFilePath(filePath)
        setScreen('processing')
        setProgress(0, 'Avvio elaborazione...')

        const removeListener = window.electronAPI.onProgress(({ percent, message }) => {
          setProgress(percent, message)
        })

        try {
          const result = await window.electronAPI.processDocument(filePath)

          if ('error' in result && result.error) {
            setError(String(result.error))
            setScreen('dropzone')
            return
          }

          setAnalysisResult(result as import('@shared/types').DocumentAnalysisResult)
          setScreen('review')
        } catch (err) {
          setError(err instanceof Error ? err.message : "Errore durante l'elaborazione.")
          setScreen('dropzone')
        } finally {
          removeListener()
        }
        return
      }

      // ── File multipli: flusso batch ─────────────────────────────────────
      const batchFiles: BatchFileItem[] = paths.map((filePath) => ({
        filePath,
        fileName: filePath.split('/').pop() ?? filePath,
        status: 'pending',
      }))

      await startBatchAnalysis(batchFiles)
    },
    [setFilePath, setScreen, setProgress, setAnalysisResult, setError, startBatchAnalysis]
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME,
    multiple: true,
  })

  const borderColor = isDragReject
    ? 'border-red-400 bg-red-50'
    : isDragActive
      ? 'border-blue-400 bg-blue-50'
      : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-between mb-2">
        <span className="text-xs text-slate-300 select-none">v. {version}</span>
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label="Impostazioni"
          title="Impostazioni"
        >
          <Settings size={18} />
        </button>
      </div>
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-3">
          <ShieldCheck className="text-blue-600" size={36} />
          <h1 className="text-2xl font-bold text-slate-800">Anonimator</h1>
        </div>
        <p className="text-slate-500">Anonimizzatore di documenti legali — elaborazione locale</p>
      </div>

      {/* Drop area */}
      <div
        {...getRootProps()}
        className={`
          w-full max-w-lg border-2 border-dashed rounded-2xl p-10
          flex flex-col items-center gap-4 cursor-pointer
          transition-colors duration-150
          ${borderColor}
        `}
      >
        <input {...getInputProps()} />
        <Upload
          size={48}
          className={isDragActive ? 'text-blue-500' : 'text-slate-400'}
        />
        {isDragReject ? (
          <p className="text-red-600 font-medium text-center">
            Formato non supportato.
          </p>
        ) : isDragActive ? (
          <p className="text-blue-600 font-medium text-center">
            Rilascia i file qui
          </p>
        ) : (
          <>
            <p className="text-slate-700 font-medium text-center">
              Trascina uno o più documenti qui, oppure clicca per selezionarli
            </p>
            <p className="text-slate-400 text-sm text-center">
              {ACCEPTED_EXTENSIONS.join('  ')}
            </p>
          </>
        )}
      </div>

      {/* Formati supportati */}
      <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-lg">
        {[
          { label: 'PDF', desc: 'nativi e scansionati' },
          { label: 'Word', desc: '.docx' },
          { label: 'OpenDocument', desc: '.odt' },
          { label: 'Testo', desc: '.txt' },
          { label: 'Immagini', desc: 'PNG, JPG' },
        ].map(({ label, desc }) => (
          <div key={label} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
            <FileText size={14} className="text-slate-400" />
            <span className="text-xs text-slate-600 font-medium">{label}</span>
            <span className="text-xs text-slate-400">{desc}</span>
          </div>
        ))}
      </div>

      {/* Privacy badge */}
      <p className="mt-8 text-xs text-slate-400 flex items-center gap-1.5">
        <ShieldCheck size={13} className="text-green-500" />
        Nessun dato inviato in rete — elaborazione completamente locale
      </p>

      {/* Dialog errore batch (retry / skip) */}
      {errorDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-slate-800">Errore elaborazione</h3>
            <p className="text-sm text-slate-600 truncate" title={errorDialog.file.fileName}>
              {errorDialog.file.fileName}
            </p>
            {errorDialog.file.error && (
              <p className="text-xs text-red-500">{errorDialog.file.error}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => resolveErrorDialog('skip')}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                Salta
              </button>
              <button
                onClick={() => resolveErrorDialog('retry')}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
              >
                Riprova
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
