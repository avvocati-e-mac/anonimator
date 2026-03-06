import React, { useState } from 'react'
import {
  ShieldCheck, User, Building2, MapPin, CreditCard,
  Mail, Phone, AlertTriangle, ChevronDown, ChevronUp, Check
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import type { DetectedEntity, EntityType } from '@shared/types'

// ─── Configurazione visualizzazione per tipo entità ──────────────────────────
const ENTITY_CONFIG: Record<EntityType, { label: string; color: string; icon: React.ElementType }> = {
  PERSONA:        { label: 'Persona',        color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800',       icon: User },
  ORGANIZZAZIONE: { label: 'Organizzazione', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800', icon: Building2 },
  LUOGO:          { label: 'Luogo',          color: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',   icon: MapPin },
  CODICE_FISCALE: { label: 'Cod. Fiscale',   color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800', icon: CreditCard },
  PARTITA_IVA:    { label: 'P. IVA',         color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800', icon: CreditCard },
  IBAN:           { label: 'IBAN',           color: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',               icon: CreditCard },
  EMAIL:          { label: 'Email',          color: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-800',         icon: Mail },
  TELEFONO:       { label: 'Telefono',       color: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800',         icon: Phone },
}

function EntityRow({ entity }: { entity: DetectedEntity }): React.JSX.Element {
  const { toggleEntityConfirmed, updateEntityPseudonym } = useSessionStore()
  const config = ENTITY_CONFIG[entity.type]
  const Icon = config.icon
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entity.pseudonym)

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
    entities, analysisResult, filePath,
    setScreen, setProgress, setSuccessInfo, setError, reset
  } = useSessionStore()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showWarnings, setShowWarnings] = useState(true)

  const confirmedCount = entities.filter((e) => e.confirmed).length
  const warnings = analysisResult?.warnings ?? []

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
      setScreen('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante l\'anonimizzazione.')
      setScreen('review')
    } finally {
      removeListener()
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
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={reset}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200"
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
              ? 'Seleziona almeno un\'entità'
              : `Anonimizza ${confirmedCount} entit${confirmedCount === 1 ? 'à' : 'à'}`}
          </button>
        </div>
      </footer>
    </div>
  )
}
