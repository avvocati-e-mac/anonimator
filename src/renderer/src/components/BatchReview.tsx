import React, { useState } from 'react'
import {
  ShieldCheck, User, Building2, MapPin, CreditCard,
  Mail, Phone, ChevronDown, ChevronUp, Check, Files
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import type { EntityType } from '@shared/types'
import type { MergedEntity } from '../store/sessionStore'

// ─── Configurazione visualizzazione per tipo entità ──────────────────────────
const ENTITY_CONFIG: Record<EntityType, { label: string; color: string; icon: React.ElementType }> = {
  PERSONA:        { label: 'Persona',        color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800',           icon: User },
  ORGANIZZAZIONE: { label: 'Organizzazione', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800', icon: Building2 },
  LUOGO:          { label: 'Luogo',          color: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',       icon: MapPin },
  CODICE_FISCALE: { label: 'Cod. Fiscale',   color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800', icon: CreditCard },
  PARTITA_IVA:    { label: 'P. IVA',         color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800', icon: CreditCard },
  IBAN:           { label: 'IBAN',           color: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',                   icon: CreditCard },
  EMAIL:          { label: 'Email',          color: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-800',             icon: Mail },
  TELEFONO:       { label: 'Telefono',       color: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800',             icon: Phone },
}

function EntityRow({ entity }: { entity: MergedEntity }): React.JSX.Element {
  const { toggleMergedEntityConfirmed, updateMergedEntityPseudonym } = useSessionStore()
  const config = ENTITY_CONFIG[entity.type]
  const Icon = config.icon
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entity.pseudonym)

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

      {/* Badge tipo */}
      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${config.color}`}>
        <Icon size={11} />
        {config.label}
      </span>

      {/* Testo originale */}
      <div className="flex-1 min-w-0">
        <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate block" title={entity.originalText}>
          {entity.originalText}
        </span>
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
  } = useSessionStore()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showFileList, setShowFileList] = useState(false)

  const doneFiles = batchFiles.filter((f) => f.status === 'done')
  const confirmedCount = mergedEntities.filter((e) => e.confirmed).length

  async function handleAnonymize(): Promise<void> {
    if (confirmedCount === 0) return
    setIsSubmitting(true)
    setProgress(0, 'Avvio anonimizzazione batch...')
    setScreen('batch-processing')

    // Per ogni file: filtra le entità che compaiono in quel file
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
      // In caso di errore catastrofico torna alla revisione
      setScreen('batch-review')
    } finally {
      setIsSubmitting(false)
    }
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
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={reset}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40"
          >
            Annulla
          </button>
          <div className="flex-1" />
          <button
            onClick={handleAnonymize}
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
    </div>
  )
}
