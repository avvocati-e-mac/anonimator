import React from 'react'
import { Timer } from 'lucide-react'
import type { SessionStats } from '../store/sessionStore'

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  const parts: string[] = []
  if (h > 0) parts.push(`${h} or${h === 1 ? 'a' : 'e'}`)
  if (m > 0) parts.push(`${m} min`)
  if (s > 0 || parts.length === 0) parts.push(`${s} sec`)
  return parts.join(', ')
}

interface Props {
  stats: SessionStats
}

export default function SessionStatsBanner({ stats }: Props): React.JSX.Element {
  const { totalFiles, totalPages, elapsedMs } = stats
  const elapsedSec = elapsedMs / 1000
  const throughput = elapsedSec > 0 ? (totalPages / elapsedSec).toFixed(2) : '—'

  return (
    <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Timer size={14} className="text-slate-400" />
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Statistiche
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr>
            <td className="text-slate-500 dark:text-slate-400 py-0.5">File processati</td>
            <td className="text-right font-medium text-slate-700 dark:text-slate-300 py-0.5">{totalFiles}</td>
          </tr>
          <tr>
            <td className="text-slate-500 dark:text-slate-400 py-0.5">Pagine totali</td>
            <td className="text-right font-medium text-slate-700 dark:text-slate-300 py-0.5">{totalPages}</td>
          </tr>
          <tr>
            <td className="text-slate-500 dark:text-slate-400 py-0.5">Tempo trascorso</td>
            <td className="text-right font-medium text-slate-700 dark:text-slate-300 py-0.5">{formatElapsed(elapsedMs)}</td>
          </tr>
          <tr>
            <td className="text-slate-500 dark:text-slate-400 py-0.5">Throughput</td>
            <td className="text-right font-medium text-slate-700 dark:text-slate-300 py-0.5">{throughput} pag/s</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
