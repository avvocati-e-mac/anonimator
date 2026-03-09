import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  ShieldCheck, Check,
  AlertTriangle, ChevronDown, ChevronUp,
  Plus, Download, Upload, Pencil
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { useSessionStore } from '../store/sessionStore'
import { ENTITY_CONFIG } from '../utils/entityConfig'
import AddEntityModal from './AddEntityModal'
import type { DetectedEntity, EntityType } from '@shared/types'

const ACCEPTED_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'text/plain': ['.txt'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
}

function EntityRow({ entity }: { entity: DetectedEntity }): React.JSX.Element {
  const { toggleEntityConfirmed, updateEntityPseudonym, updateEntityType, updateEntityOriginalText } = useSessionStore()
  const config = ENTITY_CONFIG[entity.type]
  const Icon = config.icon

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entity.pseudonym)

  const [editingOriginal, setEditingOriginal] = useState(false)
  const [draftOriginal, setDraftOriginal] = useState(entity.originalText)

  const [editingType, setEditingType] = useState(false)

  function commitEdit(): void {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== entity.pseudonym) {
      updateEntityPseudonym(entity.id, trimmed)
    } else {
      setDraft(entity.pseudonym)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') { setDraft(entity.pseudonym); setEditing(false) }
  }

  function commitOriginalEdit(): void {
    const trimmed = draftOriginal.trim()
    if (trimmed && trimmed !== entity.originalText) {
      updateEntityOriginalText(entity.id, trimmed)
    } else {
      setDraftOriginal(entity.originalText)
    }
    setEditingOriginal(false)
  }

  function handleOriginalKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') commitOriginalEdit()
    if (e.key === 'Escape') { setDraftOriginal(entity.originalText); setEditingOriginal(false) }
  }

  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded-lg border transition-opacity
        ${entity.confirmed ? 'opacity-100' : 'opacity-40'}
        bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700
      `}
    >
      {/* Checkbox */}
      <button
        onClick={() => toggleEntityConfirmed(entity.id)}
        className={`
          w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors
          ${entity.confirmed
            ? 'bg-blue-600 border-blue-600'
            : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500'}
        `}
        aria-label={entity.confirmed ? 'Deseleziona' : 'Seleziona'}
      >
        {entity.confirmed && <Check size={12} className="text-white" strokeWidth={3} />}
      </button>

      {/* Badge tipo — cliccabile per cambiare */}
      <div className="relative flex-shrink-0">
        {editingType ? (
          <select
            autoFocus
            value={entity.type}
            onChange={(e) => { updateEntityType(entity.id, e.target.value as EntityType); setEditingType(false) }}
            onBlur={() => setEditingType(false)}
            className="text-xs rounded-full border px-2 py-0.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            {(Object.keys(ENTITY_CONFIG) as EntityType[]).map((t) => (
              <option key={t} value={t}>{ENTITY_CONFIG[t].label}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setEditingType(true)}
            title="Clicca per cambiare tipo"
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity hover:opacity-80 ${config.color}`}
          >
            <Icon size={11} />
            {config.label}
          </button>
        )}
      </div>

      {/* Testo originale — cliccabile per modificare */}
      <div className="flex-1 min-w-0 group">
        {editingOriginal ? (
          <input
            autoFocus
            value={draftOriginal}
            onChange={(e) => setDraftOriginal(e.target.value)}
            onBlur={commitOriginalEdit}
            onKeyDown={handleOriginalKeyDown}
            title="Modifica il testo da cercare nel documento"
            className="text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-blue-400 rounded px-2 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <button
            onClick={() => { setDraftOriginal(entity.originalText); setEditingOriginal(true) }}
            title="Modifica il testo da cercare nel documento"
            className="flex items-center gap-1 w-full text-left text-sm text-slate-700 dark:text-slate-300 font-medium truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-text"
          >
            <span className="truncate">{entity.originalText}</span>
            <Pencil size={11} className="flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
          </button>
        )}
      </div>

      <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0">→</span>

      {/* Pseudonimo editabile */}
      <div className="flex-shrink-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="text-sm font-mono text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-blue-400 rounded px-2 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <button
            onClick={() => { setDraft(entity.pseudonym); setEditing(true) }}
            title="Clicca per modificare"
            className="text-sm font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-300 dark:hover:border-blue-700 border border-transparent px-2 py-0.5 rounded transition-colors cursor-text"
          >
            {entity.pseudonym}
          </button>
        )}
      </div>

      {/* Occorrenze */}
      {entity.occurrences > 1 && (
        <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
          ×{entity.occurrences}
        </span>
      )}
    </div>
  )
}

export default function EntityReview(): React.JSX.Element {
  const {
    entities, analysisResult, filePath, processingStartedAt,
    setScreen, setProgress, setSuccessInfo, setSessionStats, setError, reset,
    addEntity, importEntitiesToSingle, setFilePathAndMerge,
  } = useSessionStore()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showWarnings, setShowWarnings] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [isAddingEntity, setIsAddingEntity] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const confirmedCount = entities.filter((e) => e.confirmed).length
  const warnings = analysisResult?.warnings ?? []

  const isRestoredSession = filePath === null

  // ── Mini drop zone per sessione ripristinata ──────────────────────────────
  const nativeDropPathsRef = useRef<string[]>([])

  useEffect(() => {
    if (!isRestoredSession) return
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
  }, [isRestoredSession])

  const onDropDocument = useCallback(async (accepted: File[]): Promise<void> => {
    if (accepted.length === 0) return
    const nativePaths = nativeDropPathsRef.current
    nativeDropPathsRef.current = []
    const resolvedPath = nativePaths[0] || window.electronAPI.getPathForFile(accepted[0]) || ''
    if (!resolvedPath) return

    setIsAnalyzing(true)
    setProgress(0, 'Analisi documento...')

    const removeListener = window.electronAPI.onProgress(({ percent, message }) => {
      setProgress(percent, message)
    })
    try {
      const result = await window.electronAPI.processDocument(resolvedPath)
      if ('error' in result && result.error) {
        setError(String(result.error))
        return
      }
      const analysisResult = result as import('@shared/types').DocumentAnalysisResult
      // Merge entità rilevate con quelle già presenti e setta filePath
      setFilePathAndMerge(resolvedPath, analysisResult.entities)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante l'analisi.")
    } finally {
      removeListener()
      setIsAnalyzing(false)
    }
  }, [setProgress, setError, setFilePathAndMerge])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropDocument,
    accept: ACCEPTED_MIME,
    multiple: false,
    disabled: !isRestoredSession || isAnalyzing,
  })

  async function handleAnonymize(): Promise<void> {
    if (!filePath) return
    setIsSubmitting(true)
    setProgress(0, 'Avvio anonimizzazione...')
    setScreen('processing')

    const removeListener = window.electronAPI.onProgress(({ percent, message }) => {
      setProgress(percent, message)
    })

    try {
      const result = await window.electronAPI.anonymizeDocument({ filePath, entities })

      if ('error' in result && result.error) {
        setError(String(result.error))
        setScreen('review')
        return
      }

      const saved = result as import('@shared/types').SaveResult
      setSuccessInfo({
        outputPath: saved.outputPath,
        entitiesReplaced: saved.entitiesReplaced,
        fileName: filePath.split('/').pop() ?? '',
      })
      setSessionStats({
        totalFiles: 1,
        totalPages: analysisResult?.pageCount ?? 1,
        elapsedMs: processingStartedAt ? Date.now() - processingStartedAt : 0,
      })
      setScreen('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante l\'anonimizzazione.')
      setScreen('review')
    } finally {
      removeListener()
      setIsSubmitting(false)
    }
  }

  async function handleAddEntity(originalText: string, type: EntityType): Promise<void> {
    setIsAddingEntity(true)
    try {
      const result = await window.electronAPI.addEntity(originalText, type)
      if ('error' in result) {
        setError(result.error)
        return
      }
      addEntity({
        id: result.id,
        type,
        originalText,
        pseudonym: result.pseudonym,
        occurrences: 1,
        confirmed: true,
      })
      setShowAddModal(false)
    } finally {
      setIsAddingEntity(false)
    }
  }

  async function handleExport(): Promise<void> {
    const rawName = analysisResult?.fileName ?? filePath?.split('/').pop() ?? ''
    const baseName = rawName.replace(/\.[^.]+$/, '') || 'dizionario-entita'
    await window.electronAPI.exportEntities(
      entities.map((e) => ({ originalText: e.originalText, pseudonym: e.pseudonym, type: e.type })),
      baseName,
    )
  }

  async function handleImport(): Promise<void> {
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
    importEntitiesToSingle(imported)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header fisso */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={22} className="text-blue-600" />
          <span className="font-semibold text-slate-800 dark:text-slate-100">Anonimator</span>
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {analysisResult?.fileName && (
            <span className="truncate max-w-xs block" title={analysisResult.fileName}>
              {analysisResult.fileName}
            </span>
          )}
        </div>
      </header>

      {/* Corpo scrollabile */}
      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Mini drop zone — visibile solo quando sessione ripristinata o analisi in corso */}
          {(isRestoredSession || isAnalyzing) && (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors
                ${isDragActive
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
                  : 'border-slate-300 bg-white hover:border-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-blue-500'}
                ${isAnalyzing ? 'opacity-60 pointer-events-none' : ''}
              `}
            >
              <input {...getInputProps()} />
              <Upload size={28} className={isDragActive ? 'text-blue-500' : 'text-slate-400'} />
              <p className="text-sm font-medium text-center text-slate-700 dark:text-slate-300">
                {isAnalyzing
                  ? 'Analisi in corso...'
                  : isDragActive
                    ? 'Rilascia il documento qui'
                    : 'Trascina il documento da anonimizzare, oppure clicca per selezionarlo'}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                PDF · DOCX · ODT · TXT · PNG · JPG
              </p>
            </div>
          )}

          {/* Titolo e contatori */}
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Revisione entità rilevate
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {entities.length === 0
                ? 'Nessuna entità rilevata nel documento.'
                : `${entities.length} entità trovate — ${confirmedCount} selezionate per l'anonimizzazione.`}
            </p>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
                onClick={() => setShowWarnings(!showWarnings)}
              >
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300 flex-1">
                  {warnings.length} avviso{warnings.length > 1 ? 'i' : ''}
                </span>
                {showWarnings
                  ? <ChevronUp size={16} className="text-amber-500" />
                  : <ChevronDown size={16} className="text-amber-500" />}
              </button>
              {showWarnings && (
                <ul className="px-4 pb-3 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-sm text-amber-700 dark:text-amber-400">{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Lista entità */}
          {entities.length > 0 && (
            <div className="space-y-1">
              {entities.map((entity) => (
                <EntityRow key={entity.id} entity={entity} />
              ))}
            </div>
          )}

          {/* Spazio per non coprire il footer */}
          <div className="h-4" />
        </div>
      </main>

      {/* Footer con azioni — fisso in basso */}
      <footer className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <button
            onClick={reset}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Annulla
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            disabled={isSubmitting}
            title="Aggiungi entità manualmente"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-40 transition-colors"
          >
            <Plus size={15} />
            Aggiungi
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={isSubmitting}
            title="Esporta entità come file JSON"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-40 transition-colors"
          >
            <Download size={15} />
            Esporta
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={isSubmitting}
            title="Importa entità da file JSON"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-40 transition-colors"
          >
            <Upload size={15} />
            Importa
          </button>
          <div className="flex-1" />
          <button
            onClick={() => void handleAnonymize()}
            disabled={isSubmitting || confirmedCount === 0 || isRestoredSession}
            title={isRestoredSession ? 'Trascina un documento per anonimizzare' : undefined}
            className="
              px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg
              hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {isRestoredSession
              ? 'Trascina un documento'
              : confirmedCount === 0
                ? 'Seleziona almeno un\'entità'
                : `Anonimizza ${confirmedCount} entità`}
          </button>
        </div>
      </footer>

      {/* Modal aggiunta entità */}
      {showAddModal && (
        <AddEntityModal
          onConfirm={handleAddEntity}
          onClose={() => setShowAddModal(false)}
          isLoading={isAddingEntity}
        />
      )}
    </div>
  )
}
