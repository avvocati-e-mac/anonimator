import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, ArrowLeft, Cpu, CheckCircle2, XCircle,
  Loader2, RefreshCw, ChevronDown
} from 'lucide-react'
import type { LlmConfig } from '@shared/types'
import { DEFAULT_LLM_CONFIG } from '@shared/types'

interface SettingsScreenProps {
  onBack: () => void
}

type TestState = 'idle' | 'loading' | 'ok' | 'error'

export default function SettingsScreen({ onBack }: SettingsScreenProps): React.JSX.Element {
  const [llm, setLlm] = useState<LlmConfig>(DEFAULT_LLM_CONFIG)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)

  // Carica la configurazione salvata all'apertura
  useEffect(() => {
    window.electronAPI.getSettings().then(({ llm: saved }) => {
      setLlm(saved)
      if (saved.baseUrl) loadModels(saved.baseUrl)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadModels = useCallback(async (baseUrl: string) => {
    if (!baseUrl) return
    setLoadingModels(true)
    try {
      const { models } = await window.electronAPI.listLlmModels(baseUrl)
      setAvailableModels(models)
    } catch {
      setAvailableModels([])
    } finally {
      setLoadingModels(false)
    }
  }, [])

  async function handleTest(): Promise<void> {
    setTestState('loading')
    setTestMessage('')
    const result = await window.electronAPI.testLlm(llm)
    setTestState(result.ok ? 'ok' : 'error')
    setTestMessage(result.message)
    if (result.models) setAvailableModels(result.models)
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    await window.electronAPI.setSettings({ llm })
    setSaving(false)
    onBack()
  }

  function handleUrlBlur(): void {
    if (llm.baseUrl) loadModels(llm.baseUrl)
  }

  const inputClass =
    'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          aria-label="Indietro"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-blue-600" />
          <span className="font-semibold text-slate-800">Impostazioni</span>
        </div>
      </header>

      {/* Corpo */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-xl mx-auto space-y-6">

          {/* Sezione LLM */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-blue-600" />
              <h2 className="font-semibold text-slate-800">LLM locale (opzionale)</h2>
            </div>
            <p className="text-sm text-slate-500">
              Connetti un server LLM locale (Ollama, LM Studio, ecc.) per migliorare il
              riconoscimento dei nomi. I dati non escono mai dalla tua macchina.
            </p>

            {/* Toggle abilitazione */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setLlm((prev) => ({ ...prev, enabled: !prev.enabled }))}
                className={`
                  relative w-11 h-6 rounded-full transition-colors flex-shrink-0 cursor-pointer
                  ${llm.enabled ? 'bg-blue-600' : 'bg-slate-300'}
                `}
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                    ${llm.enabled ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </div>
              <span className="text-sm font-medium text-slate-700">
                {llm.enabled ? 'Abilitato' : 'Disabilitato'}
              </span>
            </label>

            {llm.enabled && (
              <div className="space-y-4 pt-1">
                {/* Base URL */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    URL server
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    value={llm.baseUrl}
                    onChange={(e) => setLlm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    onBlur={handleUrlBlur}
                    placeholder="http://localhost:11434/v1"
                    spellCheck={false}
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Ollama: <code>http://localhost:11434</code> · LM Studio: <code>http://localhost:1234</code> · il <code>/v1</code> viene aggiunto automaticamente
                  </p>
                </div>

                {/* Selezione modello */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-600">Modello</label>
                    <button
                      onClick={() => loadModels(llm.baseUrl)}
                      disabled={loadingModels || !llm.baseUrl}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-40"
                    >
                      <RefreshCw size={11} className={loadingModels ? 'animate-spin' : ''} />
                      Aggiorna lista
                    </button>
                  </div>

                  {availableModels.length > 0 ? (
                    <div className="relative">
                      <select
                        className={inputClass + ' appearance-none pr-8'}
                        value={llm.model}
                        onChange={(e) => setLlm((prev) => ({ ...prev, model: e.target.value }))}
                      >
                        <option value="">-- Seleziona modello --</option>
                        {availableModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  ) : (
                    <input
                      type="text"
                      className={inputClass}
                      value={llm.model}
                      onChange={(e) => setLlm((prev) => ({ ...prev, model: e.target.value }))}
                      placeholder="es. llama3.2, mistral, gemma3..."
                      spellCheck={false}
                    />
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    Clicca &quot;Aggiorna lista&quot; per caricare i modelli disponibili sul server.
                  </p>
                </div>

                {/* Impostazioni avanzate */}
                <details className="group">
                  <summary className="text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-700 list-none flex items-center gap-1">
                    <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                    Impostazioni avanzate
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Max token risposta
                      </label>
                      <input
                        type="number"
                        className={inputClass}
                        value={llm.maxTokens}
                        min={256}
                        max={32768}
                        onChange={(e) =>
                          setLlm((prev) => ({ ...prev, maxTokens: parseInt(e.target.value) || 8192 }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Timeout (secondi)
                      </label>
                      <input
                        type="number"
                        className={inputClass}
                        value={Math.round(llm.timeoutMs / 1000)}
                        min={5}
                        max={600}
                        onChange={(e) =>
                          setLlm((prev) => ({
                            ...prev,
                            timeoutMs: (parseInt(e.target.value) || 120) * 1000
                          }))
                        }
                      />
                    </div>
                  </div>
                </details>

                {/* Bottone test connessione */}
                <button
                  onClick={handleTest}
                  disabled={testState === 'loading' || !llm.baseUrl}
                  className="
                    flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border
                    border-slate-300 text-slate-700 hover:bg-slate-50
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                  "
                >
                  {testState === 'loading'
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Cpu size={14} />}
                  Testa connessione
                </button>

                {/* Risultato test */}
                {testState !== 'idle' && testState !== 'loading' && (
                  <div
                    className={`
                      flex items-start gap-2 px-3 py-2 rounded-lg text-sm
                      ${testState === 'ok'
                        ? 'bg-green-50 text-green-800 border border-green-200'
                        : 'bg-red-50 text-red-800 border border-red-200'}
                    `}
                  >
                    {testState === 'ok'
                      ? <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />
                      : <XCircle size={15} className="flex-shrink-0 mt-0.5" />}
                    <span>{testMessage}</span>
                  </div>
                )}
              </div>
            )}
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
        >
          Annulla
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving}
          className="
            px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg
            hover:bg-blue-700 disabled:opacity-40 transition-colors
          "
        >
          {saving ? 'Salvataggio...' : 'Salva'}
        </button>
      </footer>
    </div>
  )
}
