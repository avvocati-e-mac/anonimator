import React, { useState } from 'react'
import { ENTITY_CONFIG } from '../utils/entityConfig'
import type { EntityType } from '@shared/types'

interface AddEntityModalProps {
  onConfirm: (originalText: string, type: EntityType) => Promise<void>
  onClose: () => void
  isLoading: boolean
}

const ENTITY_TYPES = Object.keys(ENTITY_CONFIG) as EntityType[]

export default function AddEntityModal({ onConfirm, onClose, isLoading }: AddEntityModalProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [type, setType] = useState<EntityType>('PERSONA')

  async function handleConfirm(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    await onConfirm(trimmed, type)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void handleConfirm()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md space-y-4 p-6">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100">
          Aggiungi entità manualmente
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Testo originale
            </label>
            <input
              autoFocus
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="es. Mario Rossi"
              className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Tipo entità
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EntityType)}
              className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{ENTITY_CONFIG[t].label}</option>
              ))}
            </select>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500">
            Il pseudonimo verrà generato automaticamente secondo le regole della sessione.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40"
          >
            Annulla
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={!text.trim() || isLoading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Aggiunta...' : 'Aggiungi'}
          </button>
        </div>
      </div>
    </div>
  )
}
