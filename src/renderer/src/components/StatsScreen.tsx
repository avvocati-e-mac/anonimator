import React, { useEffect, useState } from 'react'
import { X, Trash2, Clock, FileText, Users, Zap, Cpu } from 'lucide-react'
import type { ElaborationStats } from '@shared/types'

interface StatsScreenProps {
  onClose: () => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function truncateFileName(name: string, maxLen = 35): string {
  if (name.length <= maxLen) return name
  const ext = name.lastIndexOf('.')
  if (ext > 0) {
    const base = name.slice(0, ext)
    const extension = name.slice(ext)
    const available = maxLen - extension.length - 1
    return base.slice(0, available) + '\u2026' + extension
  }
  return name.slice(0, maxLen - 1) + '\u2026'
}

// Barra percentuale colorata
function PhaseBar({ label, durationMs, totalMs }: { label: string; durationMs: number; totalMs: number }): React.JSX.Element {
  const pct = totalMs > 0 ? Math.round((durationMs / totalMs) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-slate-500 dark:text-slate-400 truncate">{label}</span>
      <span className="w-14 text-right font-mono text-slate-600 dark:text-slate-300">{formatDuration(durationMs)}</span>
      <span className="w-10 text-right text-slate-400 dark:text-slate-500">{pct}%</span>
      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  )
}

export default function StatsScreen({ onClose }: StatsScreenProps): React.JSX.Element {
  const [entries, setEntries] = useState<ElaborationStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI.getStats().then((data) => {
      setEntries(data)
      setLoading(false)
    })
  }, [])

  async function handleClear(): Promise<void> {
    const confirmed = window.confirm('Cancellare tutte le statistiche di elaborazione?')
    if (!confirmed) return
    await window.electronAPI.clearStats()
    setEntries([])
  }

  // Aggregati
  const totalDocs = entries.length
  const totalEntities = entries.reduce((s, e) => s + e.entitiesFound, 0)
  const avgMs = totalDocs > 0 ? Math.round(entries.reduce((s, e) => s + e.phases.total.durationMs, 0) / totalDocs) : 0
  const avgMsPage = totalDocs > 0 ? Math.round(entries.reduce((s, e) => s + e.msPerPage, 0) / totalDocs) : 0

  const latest = entries[0] ?? null

  // Top 5 entity types for latest
  const topTypes = latest
    ? Object.entries(latest.entitiesByType)
        .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
        .slice(0, 5)
    : []

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] mx-4 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Zap size={20} className="text-blue-500" />
            Statistiche di elaborazione
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700 transition-colors"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {loading ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">Caricamento...</p>
          ) : totalDocs === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
              Nessuna elaborazione registrata.
            </p>
          ) : (
            <>
              {/* ── Riepilogo ─────────────────────────────────────────────────────── */}
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Riepilogo</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat icon={<FileText size={14} />} label="Documenti" value={String(totalDocs)} />
                  <Stat icon={<Users size={14} />} label="Entit\u00e0 totali" value={String(totalEntities)} />
                  <Stat icon={<Clock size={14} />} label="Tempo medio/doc" value={formatDuration(avgMs)} />
                  <Stat icon={<Zap size={14} />} label="Tempo medio/pag" value={formatDuration(avgMsPage)} />
                </div>
              </div>

              {/* ── Ultima elaborazione ────────────────────────────────────────────── */}
              {latest && (
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Ultima elaborazione</h3>

                  {/* Info documento */}
                  <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <FileText size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                    <span className="font-medium truncate" title={latest.fileName}>{truncateFileName(latest.fileName)}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 uppercase">{latest.format}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{latest.pageCount} pag</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto flex-shrink-0">{formatDate(latest.processedAt)}</span>
                  </div>

                  {/* Barre fasi */}
                  <div className="space-y-1.5">
                    <PhaseBar label="Parsing" durationMs={latest.phases.parsing.durationMs} totalMs={latest.phases.total.durationMs} />
                    <PhaseBar label="NER regex" durationMs={latest.phases.nerRegex.durationMs} totalMs={latest.phases.total.durationMs} />
                    <PhaseBar label="NER BERT" durationMs={latest.phases.nerBert.durationMs} totalMs={latest.phases.total.durationMs} />
                    {latest.phases.llm && (
                      <PhaseBar
                        label={`LLM${latest.llm ? ` (${latest.llm.model})` : ''}`}
                        durationMs={latest.phases.llm.durationMs}
                        totalMs={latest.phases.total.durationMs}
                      />
                    )}
                    <PhaseBar label="Anonimizzazione" durationMs={latest.phases.anonymization.durationMs} totalMs={latest.phases.total.durationMs} />
                    <div className="flex items-center gap-2 text-xs pt-1 border-t border-slate-200 dark:border-slate-700">
                      <span className="w-28 font-semibold text-slate-600 dark:text-slate-300">Totale</span>
                      <span className="w-14 text-right font-mono font-semibold text-slate-700 dark:text-slate-200">{formatDuration(latest.phases.total.durationMs)}</span>
                    </div>
                  </div>

                  {/* Dettagli entita e testo */}
                  <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">Entit\u00e0 trovate:</span>{' '}
                      {latest.entitiesFound}
                      {topTypes.length > 0 && (
                        <span className="ml-1.5">
                          ({topTypes.map(([t, n]) => `${t} ${n}`).join(' \u00b7 ')})
                        </span>
                      )}
                    </p>
                    {latest.llm && latest.llm.estimatedTokensSent > 0 && (
                      <p className="flex items-center gap-1">
                        <Cpu size={11} className="flex-shrink-0" />
                        LLM: ~{latest.llm.tokensPerSecond} tok/s \u00b7 ~{latest.llm.estimatedTokensSent.toLocaleString('it-IT')} tok inviati
                      </p>
                    )}
                    <p>
                      Testo estratto: {latest.textLength.toLocaleString('it-IT')} car \u00b7 {latest.textLengthPerPage.toLocaleString('it-IT')} car/pagina
                    </p>
                  </div>
                </div>
              )}

              {/* ── Storico ───────────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Storico</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700">
                        <th className="py-1.5 pr-3 font-medium">Data</th>
                        <th className="py-1.5 pr-3 font-medium">File</th>
                        <th className="py-1.5 pr-2 font-medium">Formato</th>
                        <th className="py-1.5 pr-2 font-medium text-right">Pag</th>
                        <th className="py-1.5 pr-2 font-medium text-right">Entit\u00e0</th>
                        <th className="py-1.5 font-medium text-right">Tempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.slice(0, 50).map((e, i) => (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-700/50 text-slate-600 dark:text-slate-300">
                          <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(e.processedAt)}</td>
                          <td className="py-1.5 pr-3 truncate max-w-[180px]" title={e.fileName}>{truncateFileName(e.fileName, 25)}</td>
                          <td className="py-1.5 pr-2 uppercase text-slate-400 dark:text-slate-500">{e.format}</td>
                          <td className="py-1.5 pr-2 text-right">{e.pageCount}</td>
                          <td className="py-1.5 pr-2 text-right">{e.entitiesFound}</td>
                          <td className="py-1.5 text-right font-mono">{formatDuration(e.phases.total.durationMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {totalDocs > 0 && (
          <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
            <button
              onClick={() => void handleClear()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            >
              <Trash2 size={13} />
              Cancella tutto
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  )
}
