import React from 'react'
import { Loader2, ShieldCheck, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import type { BatchFileStatus } from '@shared/types'

function StatusIcon({ status }: { status: BatchFileStatus }): React.JSX.Element {
  switch (status) {
    case 'pending':
      return <Clock size={14} className="text-slate-300" />
    case 'analyzing':
      return <Loader2 size={14} className="text-blue-500 animate-spin" />
    case 'done':
      return <CheckCircle2 size={14} className="text-green-500" />
    case 'error':
      return <XCircle size={14} className="text-red-400" />
  }
}

export default function BatchProcessingScreen(): React.JSX.Element {
  const { batchFiles, batchCurrentFileIndex, progressPercent, progressMessage } = useSessionStore()

  const total = batchFiles.length
  const currentFile = batchFiles[batchCurrentFileIndex - 1]

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Pannello laterale: lista file */}
      <aside className="w-64 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-600" />
            <span className="font-semibold text-slate-800 text-sm">Anonimator</span>
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto py-2">
          {batchFiles.map((file, idx) => (
            <li
              key={file.filePath}
              className={`
                flex items-center gap-2.5 px-4 py-2.5
                ${idx + 1 === batchCurrentFileIndex ? 'bg-blue-50' : ''}
              `}
            >
              <StatusIcon status={file.status} />
              <span
                className={`text-xs truncate flex-1 ${
                  file.status === 'error' ? 'text-red-500' :
                  idx + 1 === batchCurrentFileIndex ? 'text-blue-700 font-medium' :
                  file.status === 'done' ? 'text-slate-500' : 'text-slate-400'
                }`}
                title={file.fileName}
              >
                {file.fileName}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Area principale */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-md text-center space-y-6">
          {/* Icona animata */}
          <div className="flex justify-center">
            <div className="relative">
              <ShieldCheck size={56} className="text-blue-600" />
              <Loader2
                size={24}
                className="absolute -bottom-1 -right-1 text-blue-400 animate-spin"
              />
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-800 mb-1">
              Analisi in corso
            </h2>
            <p className="text-sm text-slate-500">
              File {batchCurrentFileIndex} di {total}
            </p>
            {currentFile && (
              <p className="text-sm text-slate-600 font-medium mt-1 truncate max-w-xs mx-auto" title={currentFile.fileName}>
                {currentFile.fileName}
              </p>
            )}
          </div>

          {/* Barra progresso file corrente */}
          <div className="space-y-2">
            <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 bg-blue-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-sm text-slate-500 min-h-[1.25rem]">
              {progressMessage}
            </p>
          </div>

          {/* Progresso globale */}
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-1.5 bg-slate-400 rounded-full transition-all duration-300"
              style={{ width: `${((batchCurrentFileIndex - 1) / total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            {batchFiles.filter((f) => f.status === 'done').length} di {total} completati
          </p>

          <p className="text-xs text-slate-400">
            Il documento non lascia mai questo computer.
          </p>
        </div>
      </main>
    </div>
  )
}
