import React, { useState } from 'react'
import {
  ShieldCheck, Check, Files,
  ChevronDown, ChevronUp,
  Plus, Download, Upload, Pencil
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { ENTITY_CONFIG } from '../utils/entityConfig'
import AddEntityModal from './AddEntityModal'
import type { EntityType } from '@shared/types'
import type { MergedEntity } from '../store/sessionStore'

function EntityRow({ entity }: { entity: MergedEntity }): React.JSX.Element {
  const { toggleMergedEntityConfirmed, updateMergedEntityPseudonym, updateMergedEntityType, updateMergedEntityOriginalText } = useSessionStore()
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
      updateMergedEntityPseudonym(entity.id, trimmed)
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
      updateMergedEntityOriginalText(entity.id, trimmed)
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
        onClick={() => toggleMergedEntityConfirmed(entity.id)}
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
            onChange={(e) => { updateMergedEntityType(entity.id, e.target.value as EntityType); setEditingType(false) }}
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

      {/* Occorrenze e file */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {entity.occurrences > 1 && (
          <span className="text-xs text-slate-400 dark:text-slate-500">×{entity.occurrences}</span>
        )}
        {entity.fileCount !== undefined && entity.fileCount > 1 && (
          <span className="flex items-center gap-0.5 text-xs text-blue-500 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded px-1.5 py-0.5">
            <Files size={10} />
            {entity.fileCount}
          </span>
        )}
      </div>
    </div>
  )
}

export default function BatchReview(): React.JSX.Element {
  const {
    mergedEntities,
    batchFiles,
    setScreen,
    setProgress,
    setBatchResults,
    reset,
    addMergedEntity,
    importEntitiesToBatch,
    setError,
  } = useSessionStore()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showFileList, setShowFileList] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [isAddingEntity, setIsAddingEntity] = useState(false)

  const doneFiles = batchFiles.filter((f) => f.status === 'done')
  const confirmedCount = mergedEntities.filter((e) => e.confirmed).length

  async function handleAnonymize(): Promise<void> {
    if (confirmedCount === 0) return
    setIsSubmitting(true)
    setProgress(0, 'Avvio anonimizzazione batch...')
    setScreen('batch-processing')

    const requests = doneFiles.map((file) => ({
      filePath: file.filePath,
      entities: mergedEntities.filter((e) =>
        file.analysisResult!.entities.some(
          (fe) => fe.originalText.toLowerCase() === e.originalText.toLowerCase()
        )
      ),
    }))

    try {
      const results = await window.electronAPI.batchAnonymize(requests)
      setBatchResults(results)
      setScreen('batch-success')
    } catch {
      setScreen('batch-review')
    } finally {
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
      const newEntity: MergedEntity = {
        id: result.id,
        type,
        originalText,
        pseudonym: result.pseudonym,
        occurrences: 1,
        confirmed: true,
        fileCount: 1,
      }
      addMergedEntity(newEntity)
      setShowAddModal(false)
    } finally {
      setIsAddingEntity(false)
    }
  }

  async function handleExport(): Promise<void> {
    await window.electronAPI.exportEntities(
      mergedEntities.map((e) => ({ originalText: e.originalText, pseudonym: e.pseudonym, type: e.type }))
    )
  }

  async function handleImport(): Promise<void> {
    const result = await window.electronAPI.importEntities()
    if ('cancelled' in result || 'error' in result) return
    const imported: MergedEntity[] = result.entries.map((e) => ({
      id: e.id,
      type: e.type as EntityType,
      originalText: e.originalText,
      pseudonym: e.pseudonym,
      occurrences: 1,
      confirmed: true,
      fileCount: 1,
    }))
    importEntitiesToBatch(imported)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header fisso */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={22} className="text-blue-600" />
          <span className="font-semibold text-slate-800 dark:text-slate-100">Anonimator</span>
        </div>
        <button
          onClick={() => setShowFileList(!showFileList)}
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <Files size={14} />
          {doneFiles.length} file analizzati
          {showFileList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </header>

      {/* Lista file collassabile */}
      {showFileList && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <ul className="max-w-2xl mx-auto space-y-1">
            {doneFiles.map((f) => (
              <li key={f.filePath} className="text-sm text-slate-600 dark:text-slate-400 truncate">
                {f.fileName}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Corpo scrollabile */}
      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl mx-auto space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Revisione entità — {doneFiles.length} file analizzati
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {mergedEntities.length === 0
                ? 'Nessuna entità rilevata nei documenti.'
                : `${mergedEntities.length} entità uniche trovate — ${confirmedCount} selezionate per l'anonimizzazione.`}
            </p>
          </div>

          {mergedEntities.length > 0 && (
            <div className="space-y-1">
              {mergedEntities.map((entity) => (
                <EntityRow key={entity.id} entity={entity} />
              ))}
            </div>
          )}

          <div className="h-4" />
        </div>
      </main>

      {/* Footer con azioni */}
      <footer className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <button
            onClick={reset}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40"
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
            disabled={isSubmitting || confirmedCount === 0}
            className="
              px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg
              hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {confirmedCount === 0
              ? "Seleziona almeno un'entità"
              : `Anonimizza ${doneFiles.length} file →`}
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
