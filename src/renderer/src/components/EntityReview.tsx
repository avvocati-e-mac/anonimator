import React, { useState } from 'react'
import {
  ShieldCheck, User, Building2, MapPin, CreditCard,
  Mail, Phone, AlertTriangle, ChevronDown, ChevronUp, Check
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import type { DetectedEntity, EntityType } from '@shared/types'

// ─── Configurazione visualizzazione per tipo entità ──────────────────────────
const ENTITY_CONFIG: Record<EntityType, { label: string; color: string; icon: React.ElementType }> = {
  PERSONA:        { label: 'Persona',        color: 'bg-blue-100 text-blue-700 border-blue-200',    icon: User },
  ORGANIZZAZIONE: { label: 'Organizzazione', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Building2 },
  LUOGO:          { label: 'Luogo',          color: 'bg-green-100 text-green-700 border-green-200',  icon: MapPin },
  CODICE_FISCALE: { label: 'Cod. Fiscale',   color: 'bg-orange-100 text-orange-700 border-orange-200', icon: CreditCard },
  PARTITA_IVA:    { label: 'P. IVA',         color: 'bg-orange-100 text-orange-700 border-orange-200', icon: CreditCard },
  IBAN:           { label: 'IBAN',           color: 'bg-red-100 text-red-700 border-red-200',        icon: CreditCard },
  EMAIL:          { label: 'Email',          color: 'bg-cyan-100 text-cyan-700 border-cyan-200',     icon: Mail },
  TELEFONO:       { label: 'Telefono',       color: 'bg-teal-100 text-teal-700 border-teal-200',     icon: Phone },
}

function EntityRow({ entity }: { entity: DetectedEntity }): React.JSX.Element {
  const { toggleEntityConfirmed } = useSessionStore()
  const config = ENTITY_CONFIG[entity.type]
  const Icon = config.icon

  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded-lg border transition-opacity
        ${entity.confirmed ? 'opacity-100' : 'opacity-40'}
        bg-white border-slate-200
      `}
    >
      {/* Checkbox */}
      <button
        onClick={() => toggleEntityConfirmed(entity.id)}
        className={`
          w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors
          ${entity.confirmed
            ? 'bg-blue-600 border-blue-600'
            : 'bg-white border-slate-300'}
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

      {/* Testo originale → pseudonimo */}
      <div className="flex-1 min-w-0">
        <span className="text-sm text-slate-700 font-medium truncate block" title={entity.originalText}>
          {entity.originalText}
        </span>
      </div>
      <span className="text-slate-400 text-sm flex-shrink-0">→</span>
      <div className="flex-shrink-0">
        <span className="text-sm font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
          {entity.pseudonym}
        </span>
      </div>

      {/* Occorrenze */}
      {entity.occurrences > 1 && (
        <span className="text-xs text-slate-400 flex-shrink-0">
          ×{entity.occurrences}
        </span>
      )}
    </div>
  )
}

export default function EntityReview(): React.JSX.Element {
  const {
    entities, analysisResult, filePath,
    setScreen, setProgress, setSuccessInfo, setError
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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header fisso */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={22} className="text-blue-600" />
          <span className="font-semibold text-slate-800">LegalShield</span>
        </div>
        <div className="text-sm text-slate-500">
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
            <h2 className="text-lg font-semibold text-slate-800">
              Revisione entità rilevate
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {entities.length === 0
                ? 'Nessuna entità rilevata nel documento.'
                : `${entities.length} entità trovate — ${confirmedCount} selezionate per l'anonimizzazione.`}
            </p>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
                onClick={() => setShowWarnings(!showWarnings)}
              >
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
                <span className="text-sm font-medium text-amber-800 flex-1">
                  {warnings.length} avviso{warnings.length > 1 ? 'i' : ''}
                </span>
                {showWarnings
                  ? <ChevronUp size={16} className="text-amber-500" />
                  : <ChevronDown size={16} className="text-amber-500" />}
              </button>
              {showWarnings && (
                <ul className="px-4 pb-3 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-sm text-amber-700">{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Lista entità raggruppata per tipo */}
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
      <footer className="bg-white border-t border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => setScreen('dropzone')}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-40"
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
