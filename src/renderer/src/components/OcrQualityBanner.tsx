import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { selectOcrBannerMessage } from '../utils/ocrBannerMessage'
import type { OcrLayerReport } from '@shared/types'

interface OcrQualityBannerProps {
  report: OcrLayerReport | undefined
  pageCount: number
  onRedoOcr: () => void
  isBusy: boolean
  /** false in sessione ripristinata (filePath === null): non c'è un file da ri-processare. */
  canRedo: boolean
  /** true se l'utente ha già rifatto il riconoscimento del testo su questo documento. */
  ocrRedone: boolean
}

const SEVERITY_STYLES = {
  warning: {
    container: 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800',
    icon: 'text-amber-500',
    title: 'text-amber-800 dark:text-amber-300',
    body: 'text-amber-700 dark:text-amber-400',
    button: 'bg-amber-600 hover:bg-amber-700 text-white',
    note: 'text-amber-600 dark:text-amber-500',
  },
  critical: {
    container: 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800',
    icon: 'text-red-500',
    title: 'text-red-800 dark:text-red-300',
    body: 'text-red-700 dark:text-red-400',
    button: 'bg-red-600 hover:bg-red-700 text-white',
    note: 'text-red-600 dark:text-red-500',
  },
} as const

export default function OcrQualityBanner({
  report,
  pageCount,
  onRedoOcr,
  isBusy,
  canRedo,
  ocrRedone,
}: OcrQualityBannerProps): React.JSX.Element | null {
  const message = selectOcrBannerMessage(report, pageCount, ocrRedone)
  if (!message) return null

  const styles = SEVERITY_STYLES[message.severity]
  const disabled = isBusy || !canRedo
  const disabledReason = !canRedo
    ? 'Trascina di nuovo il documento per rifare il riconoscimento del testo.'
    : isBusy
      ? "Attendi che l'operazione in corso sia terminata."
      : undefined

  return (
    <div className={`rounded-lg p-4 space-y-2 ${styles.container}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className={`flex-shrink-0 mt-0.5 ${styles.icon}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${styles.title}`}>{message.title}</p>
          <p className={`text-sm mt-1 leading-relaxed ${styles.body}`}>{message.body}</p>
        </div>
      </div>

      {message.showRedoButton && (
        <div className="pl-6 space-y-1.5">
          <p className={`text-xs ${styles.note}`}>
            Rifacendo il riconoscimento del testo, le entità già selezionate o modificate a mano
            verranno ricalcolate da capo.
          </p>
          <button
            onClick={onRedoOcr}
            disabled={disabled}
            title={disabledReason}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles.button}`}
          >
            {`Rifai OCR (~${message.estimatedMinutes} min)`}
          </button>
        </div>
      )}
    </div>
  )
}
