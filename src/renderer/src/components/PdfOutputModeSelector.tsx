import React from 'react'
import { AlertTriangle, Images, ScanLine } from 'lucide-react'
import type { PdfOutputMode } from '@shared/types'

interface PdfOutputModeSelectorProps {
  value: PdfOutputMode
  onChange: (mode: PdfOutputMode) => void
  acknowledged: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  batch?: boolean
}

export default function PdfOutputModeSelector({
  value,
  onChange,
  acknowledged,
  onAcknowledgedChange,
  batch = false,
}: PdfOutputModeSelectorProps): React.JSX.Element {
  function select(mode: PdfOutputMode): void {
    onChange(mode)
    if (mode !== 'force-bitonal') onAcknowledgedChange(false)
  }

  return (
    <fieldset className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <legend className="px-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
        Aspetto del PDF
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
          value === 'preserve-color'
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
            : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
        }`}>
          <input
            type="radio"
            name="pdf-output-mode"
            value="preserve-color"
            checked={value === 'preserve-color'}
            onChange={() => select('preserve-color')}
            className="mt-1"
          />
          <Images size={19} className="mt-0.5 flex-shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span>
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
              Aspetto a colori (consigliato)
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              Mantiene colori e tonalità visibili con ricompressione JPEG; non è una copia pixel-identica.
            </span>
          </span>
        </label>

        <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
          value === 'force-bitonal'
            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
            : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
        }`}>
          <input
            type="radio"
            name="pdf-output-mode"
            value="force-bitonal"
            checked={value === 'force-bitonal'}
            onChange={() => select('force-bitonal')}
            className="mt-1"
          />
          <ScanLine size={19} className="mt-0.5 flex-shrink-0 text-slate-700 dark:text-slate-300" aria-hidden="true" />
          <span>
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
              Bianco e nero compatto
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              Converte in modo irreversibile le pagine scansionate a 1 bit.
            </span>
          </span>
        </label>
      </div>

      {value === 'force-bitonal' && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              Colori, timbri, firme chiare, evidenziature, fotografie e testo sbiadito possono perdere informazioni.
              {batch && ' La scelta riguarda solo PDF scansionati e immagini del batch.'}
              {' '}Il documento originale non viene modificato.
            </p>
          </div>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
              className="mt-0.5"
            />
            Ho compreso che la conversione può eliminare informazioni visive.
          </label>
        </div>
      )}
    </fieldset>
  )
}
