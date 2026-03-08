import React, { useCallback, useEffect, useState, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { ShieldCheck, Upload, FileText, Settings, Moon, Sun, History, Trash2, Lock } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { useBatchOrchestrator } from '../hooks/useBatchOrchestrator'
import type { BatchFileItem, DetectedEntity, EntityType } from '@shared/types'

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
  isDark: boolean
  onToggleDark: () => void
}

export default function DropZone({ onOpenSettings, isDark, onToggleDark }: DropZoneProps): React.JSX.Element {
  const { setFilePath, setScreen, setProgress, setAnalysisResult, setError } = useSessionStore()
  const { startBatchAnalysis, errorDialog, resolveErrorDialog } = useBatchOrchestrator()
  const [version, setVersion] = useState('')
  const [hasSavedSession, setHasSavedSession] = useState(false)
  const [sessionPath, setSessionPath] = useState('')
  const [isRestoringSession, setIsRestoringSession] = useState(false)
  const [isImportingEntities, setIsImportingEntities] = useState(false)
  // Salva i path estratti dall'evento drop nativo prima che react-dropzone cloni i File objects
  const nativeDropPathsRef = useRef<string[]>([])

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion)
    window.electronAPI.hasSavedSession().then((res) => setHasSavedSession(res.exists))
    window.electronAPI.getSessionPath().then((res) => setSessionPath(res.path))
  }, [])

  // Intercetta il drop nativo (capture phase) per ottenere i path assoluti
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

      const nativePaths = nativeDropPathsRef.current
      nativeDropPathsRef.current = []

      const paths: string[] = accepted.map((file, i) => {
        return nativePaths[i] || window.electronAPI.getPathForFile(file) || ''
      }).filter(Boolean)

      if (paths.length === 0) {
        setError('Impossibile leggere il percorso dei file. Riprova.')
        return
      }

      // ── File singolo ──────────────────────────────────────────────────────
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

      // ── File multipli: flusso batch ───────────────────────────────────────
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
    ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
    : isDragActive
      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
      : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-blue-500 dark:hover:bg-blue-950/30'

  async function handleRestoreSession(): Promise<void> {
    if (!hasSavedSession) return
    setIsRestoringSession(true)
    try {
      const result = await window.electronAPI.loadSession()
      if (!result) return
      setAnalysisResult({
        fileName: 'Sessione precedente',
        format: 'txt',
        pageCount: 0,
        entities: result.entities,
        warnings: ['Sessione ripristinata dal disco. Trascina un documento per anonimizzare.'],
      })
      setScreen('review')
    } finally {
      setIsRestoringSession(false)
    }
  }

  async function handleImportFromDropZone(): Promise<void> {
    setIsImportingEntities(true)
    try {
      const result = await window.electronAPI.importEntities()
      if ('cancelled' in result || 'error' in result) return
      const imported: DetectedEntity[] = result.entries.map((e) => ({
        id: e.id,
        type: e.type as EntityType,
        originalText: e.originalText,
        pseudonym: e.pseudonym,
        occurrences: 1,
        confirmed: true,
      }))
      setAnalysisResult({
        fileName: 'Entità importate',
        format: 'txt',
        pageCount: 0,
        entities: imported,
        warnings: ['Entità importate da file. Trascina un documento per anonimizzare.'],
      })
      setScreen('review')
    } finally {
      setIsImportingEntities(false)
    }
  }

  async function handleDeleteSession(): Promise<void> {
    const confirmed = window.confirm(
      'Eliminare la sessione salvata?\n\nI dati personali (nomi, codici fiscali, ecc.) memorizzati nel dizionario verranno cancellati definitivamente da questo dispositivo.'
    )
    if (!confirmed) return
    await window.electronAPI.deleteSession()
    setHasSavedSession(false)
  }

  // Mostra il path in forma leggibile (tronca la parte home)
  const displayPath = sessionPath
    ? sessionPath.replace(/^\/Users\/[^/]+/, '~').replace(/\\/g, '/')
    : ''

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-between mb-2">
        <span className="text-xs text-slate-300 dark:text-slate-600 select-none">v. {version}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleDark}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            aria-label={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
            title={isDark ? 'Tema chiaro' : 'Tema scuro'}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            aria-label="Impostazioni"
            title="Impostazioni"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-3">
          <ShieldCheck className="text-blue-600" size={36} />
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Anonimator</h1>
        </div>
        <p className="text-slate-500 dark:text-slate-400">Anonimizzatore di documenti legali — elaborazione locale</p>
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
          className={isDragActive ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}
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
            <p className="text-slate-700 dark:text-slate-300 font-medium text-center">
              Trascina uno o più documenti qui, oppure clicca per selezionarli
            </p>
            <p className="text-slate-400 dark:text-slate-500 text-sm text-center">
              {ACCEPTED_EXTENSIONS.join('  ')}
            </p>
          </>
        )}
      </div>

      {/* ── Sezione dizionario e sessione ────────────────────────────────────── */}
      <div className="w-full max-w-lg mt-4 space-y-2">

        {/* Blocco: Importa dizionario */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <Upload size={16} className="text-slate-400 dark:text-slate-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Importa dizionario entità
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                Carica un file .json con nomi e pseudonimi salvati in precedenza. Le entità saranno pronte senza analisi NER.
              </p>
            </div>
            <button
              onClick={() => void handleImportFromDropZone()}
              disabled={isImportingEntities}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg disabled:opacity-40 transition-colors"
            >
              {isImportingEntities ? 'Caricamento...' : 'Importa da file'}
            </button>
          </div>
        </div>

        {/* Blocco: Sessione precedente */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <History size={16} className={`mt-0.5 flex-shrink-0 ${hasSavedSession ? 'text-slate-400 dark:text-slate-500' : 'text-slate-300 dark:text-slate-600'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${hasSavedSession ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                Sessione precedente
              </p>
              {hasSavedSession ? (
                <>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    Ripristina il dizionario dell&apos;ultima anonimizzazione.
                  </p>
                  {displayPath && (
                    <p className="text-xs font-mono text-slate-300 dark:text-slate-600 mt-1 truncate" title={sessionPath}>
                      {displayPath}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  Nessuna sessione precedente salvata.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {hasSavedSession && (
                <button
                  onClick={() => void handleDeleteSession()}
                  title="Elimina sessione salvata"
                  className="px-2 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <button
                onClick={() => void handleRestoreSession()}
                disabled={!hasSavedSession || isRestoringSession}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  hasSavedSession
                    ? 'text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-40'
                    : 'text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                }`}
              >
                {isRestoringSession ? 'Caricamento...' : 'Carica'}
              </button>
            </div>
          </div>
        </div>

        {/* Nota privacy */}
        <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5 px-1">
          <Lock size={11} className="flex-shrink-0" />
          Il file sessione contiene dati personali in chiaro. Elimina la sessione quando non serve più.
        </p>
      </div>

      {/* Formati supportati */}
      <div className="mt-4 flex flex-wrap gap-2 justify-center max-w-lg">
        {[
          { label: 'PDF', desc: 'nativi e scansionati' },
          { label: 'Word', desc: '.docx' },
          { label: 'OpenDocument', desc: '.odt' },
          { label: 'Testo', desc: '.txt' },
          { label: 'Immagini', desc: 'PNG, JPG' },
        ].map(({ label, desc }) => (
          <div key={label} className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5">
            <FileText size={14} className="text-slate-400 dark:text-slate-500" />
            <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{label}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{desc}</span>
          </div>
        ))}
      </div>

      {/* Privacy badge */}
      <p className="mt-6 text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
        <ShieldCheck size={13} className="text-green-500" />
        Nessun dato inviato in rete — elaborazione completamente locale
      </p>

      {/* Dialog errore batch */}
      {errorDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Errore elaborazione</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 truncate" title={errorDialog.file.fileName}>
              {errorDialog.file.fileName}
            </p>
            {errorDialog.file.error && (
              <p className="text-xs text-red-500">{errorDialog.file.error}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => resolveErrorDialog('skip')}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
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
