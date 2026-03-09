import React, { useState } from 'react'
import { ShieldCheck, AlertTriangle, Zap, Cpu } from 'lucide-react'

interface WelcomeScreenProps {
  onDismiss: (permanent: boolean) => void
}

export default function WelcomeScreen({ onDismiss }: WelcomeScreenProps): React.JSX.Element {
  const [doNotShow, setDoNotShow] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4 py-8">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 max-w-2xl w-full">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
          <ShieldCheck size={28} className="text-blue-600 flex-shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Come funziona Anonimator</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Pseudoanonimizzazione offline di documenti legali</p>
          </div>
        </div>

        {/* Sezioni */}
        <div className="px-8 py-6 space-y-6">

          {/* Sezione 1 — Attenzione */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Riconoscimento automatico, non perfetto</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Il riconoscimento delle entità non è infallibile. Controlla sempre l'elenco prima di procedere con l'anonimizzazione.
              </p>
            </div>
          </div>

          {/* Sezione 2 — Due livelli */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <Zap size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Due livelli di analisi (sempre attivi)</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">Passo 1 — Regole e pattern:</span>{' '}
                riconosce codici fiscali, IBAN, email, numeri di telefono e altri dati strutturati in modo rapido e preciso.
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Passo 2 — Intelligenza artificiale locale (NER):</span>{' '}
                identifica nomi di persone, luoghi e organizzazioni. Funziona offline, senza internet.
              </p>
            </div>
          </div>

          {/* Sezione 3 — LLM opzionale */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                <Cpu size={16} className="text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Analisi LLM opzionale</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Passo 3 — LLM opzionale:</span>{' '}
                  un modello linguistico installato in locale (Ollama, LM Studio) può aumentare la precisione, ma richiede più tempo di elaborazione. Attivabile nelle Impostazioni ⚙.
                </p>
              </div>

              {/* Nota hardware */}
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Mac con chip Apple Silicon (M1/M2/M3/M4):</p>
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  <li><span className="font-medium">8 GB RAM</span> → modelli piccoli (Llama 3.2 3B, Phi 3.5 Mini, Qwen 2.5 3B) — meno precisi</li>
                  <li><span className="font-medium">16 GB RAM</span> → modelli medi (Mistral 7B, Llama 3.1 8B) — buon equilibrio</li>
                  <li><span className="font-medium">32 GB RAM e oltre</span> → modelli performanti (Llama 3.3 70B, Mixtral, ecc.) — alta precisione</li>
                </ul>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex items-center justify-between gap-4 border-t border-slate-100 dark:border-slate-700 pt-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={doNotShow}
              onChange={(e) => setDoNotShow(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">Non mostrare più questo messaggio</span>
          </label>
          <button
            onClick={() => onDismiss(doNotShow)}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Inizia
          </button>
        </div>
      </div>
    </div>
  )
}
