import React, { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { ShieldCheck, Upload, FileText, Settings } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'

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
  const version = window.electronAPI.getAppVersion()

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return
      const file = accepted[0]

      // In Electron, webUtils.getPathForFile restituisce il path assoluto del file droppato
      const filePath = window.electronAPI.getPathForFile(file)
      if (!filePath) {
        setError('Impossibile leggere il percorso del file. Riprova.')
        return
      }

      setFilePath(filePath)
      setScreen('processing')
      setProgress(0, 'Avvio elaborazione...')

      // Ascolta i progressi emessi dal Main process
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
        setError(err instanceof Error ? err.message : 'Errore durante l\'elaborazione.')
        setScreen('dropzone')
      } finally {
        removeListener()
      }
    },
    [setFilePath, setScreen, setProgress, setAnalysisResult, setError]
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME,
    maxFiles: 1,
    multiple: false,
  })

  const borderColor = isDragReject
    ? 'border-red-400 bg-red-50'
    : isDragActive
      ? 'border-blue-400 bg-blue-50'
      : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-end gap-2 mb-2">
        <span className="text-xs text-slate-300 select-none">v{version}</span>
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
            Rilascia il file qui
          </p>
        ) : (
          <>
            <p className="text-slate-700 font-medium text-center">
              Trascina un documento qui, oppure clicca per selezionarlo
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
    </div>
  )
}
