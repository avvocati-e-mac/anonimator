import React from 'react'
import { Clock, Cpu, Zap, FileText } from 'lucide-react'
import type { ElaborationStats } from '@shared/types'

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** Barra fase compatta */
function Bar({ label, ms, totalMs }: { label: string; ms: number; totalMs: number }): React.JSX.Element | null {
  if (ms <= 0) return null
  const pct = totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="w-24 text-slate-500 dark:text-slate-400 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 dark:bg-blue-400 rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="w-12 text-right font-mono text-slate-500 dark:text-slate-400">{fmt(ms)}</span>
    </div>
  )
}

interface ElaborationSummaryProps {
  stats: ElaborationStats[]
}

/**
 * Riepilogo compatto delle statistiche di elaborazione.
 * - Se 1 stats: mostra dettaglio singolo con barre fase.
 * - Se N stats: mostra aggregato + barre dell'ultima.
 */
export default function ElaborationSummary({ stats }: ElaborationSummaryProps): React.JSX.Element | null {
  if (stats.length === 0) return null

  const isBatch = stats.length > 1
  const latest = stats[0]

  // Aggregati
  const totalMs = stats.reduce((s, e) => s + e.phases.total.durationMs, 0)
  const totalEntities = stats.reduce((s, e) => s + e.entitiesFound, 0)
  const totalPages = stats.reduce((s, e) => s + e.pageCount, 0)
  const avgMsPage = totalPages > 0 ? Math.round(totalMs / totalPages) : 0

  // Top 5 tipi entità (aggregati)
  const byType: Record<string, number> = {}
  for (const s of stats) {
    for (const [type, count] of Object.entries(s.entitiesByType)) {
      byType[type] = (byType[type] ?? 0) + (count ?? 0)
    }
  }
  const topTypes = Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3 text-left">
      <div className="flex items-center gap-1.5">
        <Zap size={13} className="text-blue-500" />
        <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          Statistiche elaborazione
        </h3>
      </div>

      {/* Metriche principali */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
            <Clock size={11} />
            <span className="text-xs">{isBatch ? 'Tempo totale' : 'Tempo'}</span>
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmt(totalMs)}</span>
        </div>
        <div>
          <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
            <FileText size={11} />
            <span className="text-xs">{isBatch ? 'Pagine totali' : 'Pagine'}</span>
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{totalPages}</span>
        </div>
        <div>
          <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
            <Zap size={11} />
            <span className="text-xs">ms/pagina</span>
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmt(avgMsPage)}</span>
        </div>
      </div>

      {/* Barre fasi (dell'ultima elaborazione per singolo, o aggregato se batch) */}
      <div className="space-y-1">
        <Bar label="Parsing" ms={latest.phases.parsing.durationMs} totalMs={latest.phases.total.durationMs} />
        <Bar label="NER regex" ms={latest.phases.nerRegex.durationMs} totalMs={latest.phases.total.durationMs} />
        <Bar label="NER BERT" ms={latest.phases.nerBert.durationMs} totalMs={latest.phases.total.durationMs} />
        {latest.phases.llm && (
          <Bar
            label={`LLM${latest.llm ? ` (${latest.llm.model})` : ''}`}
            ms={latest.phases.llm.durationMs}
            totalMs={latest.phases.total.durationMs}
          />
        )}
        <Bar label="Anonimizzazione" ms={latest.phases.anonymization.durationMs} totalMs={latest.phases.total.durationMs} />
      </div>

      {/* Entità per tipo */}
      {topTypes.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-600 dark:text-slate-300">{totalEntities} entit&agrave;</span>
          {' \u2014 '}
          {topTypes.map(([t, n]) => `${t} ${n}`).join(' \u00b7 ')}
        </p>
      )}

      {/* LLM throughput */}
      {latest.llm && latest.llm.estimatedTokensSent > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <Cpu size={11} className="flex-shrink-0" />
          LLM: ~{latest.llm.tokensPerSecond} tok/s &middot; ~{latest.llm.estimatedTokensSent.toLocaleString('it-IT')} tok inviati
        </p>
      )}
    </div>
  )
}
