import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, ArrowLeft, Cpu, CheckCircle2, XCircle,
  Loader2, RefreshCw, ChevronDown, Moon, Sun, Lock, Unlock, RotateCcw
} from 'lucide-react'
import type { LlmConfig } from '@shared/types'
import { DEFAULT_LLM_CONFIG } from '@shared/types'

interface SettingsScreenProps {
  onBack: () => void
  isDark: boolean
  onToggleDark: () => void
}

type TestState = 'idle' | 'loading' | 'ok' | 'error'

// Modelli consigliati per CPU/Apple Silicon 8GB
const SUGGESTED_MODELS = [
  { id: 'mistral:7b-instruct-q4_K_M', label: 'Mistral 7B — Migliore per NER legale (~5GB RAM)' },
  { id: 'llama3.2:3b', label: 'Llama 3.2 3B — Leggero e veloce (~4.5GB RAM)' },
  { id: 'qwen2.5:3b', label: 'Qwen 2.5 3B — Migliore supporto italiano (~4.5GB RAM)' },
  { id: 'phi3.5:mini', label: 'Phi 3.5 Mini — Leggerissimo, fallback CPU (~3GB RAM)' },
] as const

// Preset per i due software LLM supportati
const LLM_PRESETS = {
  ollama:   { label: 'Ollama',    defaultPort: 11434, path: '/v1' },
  lmstudio: { label: 'LM Studio', defaultPort: 1234,  path: '/v1' },
} as const
type PresetKey = keyof typeof LLM_PRESETS

function buildBaseUrl(preset: PresetKey, host: string): string {
  const { defaultPort, path } = LLM_PRESETS[preset]
  const h = host.trim() || 'localhost'
  // Se l'host non include già la porta, aggiungila
  const hasPort = /:\d+$/.test(h)
  return `http://${h}${hasPort ? '' : `:${defaultPort}`}${path}`
}

function detectPresetFromUrl(url: string): PresetKey {
  if (url.includes(':1234')) return 'lmstudio'
  return 'ollama'
}

function extractHostFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname
  } catch {
    return 'localhost'
  }
}

export default function SettingsScreen({ onBack, isDark, onToggleDark }: SettingsScreenProps): React.JSX.Element {
  const [llm, setLlm] = useState<LlmConfig>(DEFAULT_LLM_CONFIG)
  const [preset, setPreset] = useState<PresetKey>('ollama')
  const [host, setHost] = useState('localhost')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [defaultPromptText, setDefaultPromptText] = useState('')
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [promptUnlocked, setPromptUnlocked] = useState(false)

  // Carica la configurazione salvata all'apertura
  useEffect(() => {
    window.electronAPI.getSettings().then(({ llm: saved }) => {
      setLlm(saved)
      const detectedPreset = detectPresetFromUrl(saved.baseUrl)
      setPreset(detectedPreset)
      setHost(extractHostFromUrl(saved.baseUrl))
      if (saved.baseUrl) loadModels(saved.baseUrl)
      // Mostra input manuale se il modello salvato non è tra i suggeriti
      const isSuggested = SUGGESTED_MODELS.some((m) => m.id === saved.model)
      setUseCustomModel(!isSuggested && saved.model !== '')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Carica il prompt di default quando cambia la lingua
  useEffect(() => {
    window.electronAPI.getDefaultPrompt(llm.promptLanguage).then(setDefaultPromptText)
  }, [llm.promptLanguage])

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

  function handlePresetChange(p: PresetKey): void {
    setPreset(p)
    const newUrl = buildBaseUrl(p, host)
    setLlm((prev) => ({ ...prev, baseUrl: newUrl }))
    loadModels(newUrl)
    setTestState('idle')
  }

  function handleHostBlur(): void {
    const newUrl = buildBaseUrl(preset, host)
    setLlm((prev) => ({ ...prev, baseUrl: newUrl }))
    loadModels(newUrl)
    setTestState('idle')
  }

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

  const inputClass =
    'w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          aria-label="Indietro"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-blue-600" />
          <span className="font-semibold text-slate-800 dark:text-slate-100">Impostazioni</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={onToggleDark}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700 transition-colors"
          aria-label={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
          title={isDark ? 'Tema chiaro' : 'Tema scuro'}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      {/* Corpo */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-xl mx-auto space-y-6">

          {/* Sezione LLM */}
          <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-blue-600" />
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">LLM locale (opzionale)</h2>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Connetti un server LLM locale per migliorare il riconoscimento dei nomi.
              I dati non escono mai dalla tua macchina.
            </p>

            {/* Toggle abilitazione */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setLlm((prev) => ({ ...prev, enabled: !prev.enabled }))}
                className={`
                  relative w-11 h-6 rounded-full transition-colors flex-shrink-0 cursor-pointer
                  ${llm.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}
                `}
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                    ${llm.enabled ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {llm.enabled ? 'Abilitato' : 'Disabilitato'}
              </span>
            </label>

            {llm.enabled && (
              <div className="space-y-4 pt-1">

                {/* Scelta preset: Ollama / LM Studio */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Software</label>
                  <div className="flex gap-2">
                    {(Object.keys(LLM_PRESETS) as PresetKey[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePresetChange(p)}
                        className={`
                          flex-1 py-2 px-3 text-sm font-medium rounded-lg border transition-colors
                          ${preset === p
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-400'}
                        `}
                      >
                        {LLM_PRESETS[p].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Host / IP */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Host (IP o localhost)
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    onBlur={handleHostBlur}
                    placeholder="localhost oppure 192.168.1.x"
                    spellCheck={false}
                  />
                </div>

                {/* URL completo (sola lettura, per verifica) */}
                <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">URL:</span>
                  <code className="text-xs text-slate-600 dark:text-slate-300 break-all">{llm.baseUrl}</code>
                </div>

                {/* Selezione modello */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Modello</label>
                    <button
                      onClick={() => loadModels(llm.baseUrl)}
                      disabled={loadingModels || !llm.baseUrl}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-40"
                    >
                      <RefreshCw size={11} className={loadingModels ? 'animate-spin' : ''} />
                      Aggiorna lista
                    </button>
                  </div>

                  {/* Modelli consigliati */}
                  <div className="relative mb-2">
                    <select
                      className={inputClass + ' appearance-none pr-8'}
                      value={useCustomModel ? '__custom__' : (llm.model || '')}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setUseCustomModel(true)
                          setLlm((prev) => ({ ...prev, model: '' }))
                        } else {
                          setUseCustomModel(false)
                          setLlm((prev) => ({ ...prev, model: e.target.value }))
                        }
                      }}
                    >
                      <option value="">-- Modelli consigliati --</option>
                      {SUGGESTED_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      <option value="__custom__">Personalizzato...</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>

                  {/* Input manuale o lista dal server */}
                  {useCustomModel ? (
                    availableModels.length > 0 ? (
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
                        placeholder="es. mistral, llama3.2, gemma3..."
                        spellCheck={false}
                      />
                    )
                  ) : null}
                </div>

                {/* Impostazioni avanzate */}
                <details className="group">
                  <summary className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 list-none flex items-center gap-1">
                    <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                    Impostazioni avanzate
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
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
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
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

                    {/* Richieste parallele */}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Velocità analisi
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1}
                          max={4}
                          step={1}
                          value={llm.parallelRequests ?? 1}
                          onChange={(e) =>
                            setLlm((prev) => ({ ...prev, parallelRequests: parseInt(e.target.value) }))
                          }
                          className="flex-1 accent-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-4 text-right">
                          {llm.parallelRequests ?? 1}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-0.5 px-0.5">
                        <span>Prudente</span>
                        <span>Veloce</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                        Controlla quante sezioni del documento vengono inviate all'assistente AI contemporaneamente.
                        Con <strong>1</strong> (predefinito) le sezioni vengono analizzate una alla volta: più lento ma stabile su qualsiasi computer.
                        Valori più alti (<strong>2–4</strong>) velocizzano l'analisi di documenti lunghi, ma richiedono un computer con GPU dedicata o molti core; su macchine meno potenti potrebbero causare errori di timeout.
                      </p>
                    </div>

                    {/* Lingua prompt — TODO [A/B-TEST]: rimuovere dopo ottimizzazione */}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                        Lingua prompt AI <span className="text-slate-400 dark:text-slate-500 font-normal">(sperimentale)</span>
                      </label>
                      <div className="flex gap-2">
                        {(['it', 'en'] as const).map((lang) => (
                          <button
                            key={lang}
                            onClick={() => setLlm((prev) => ({ ...prev, promptLanguage: lang, customPrompt: undefined }))}
                            className={`
                              flex-1 py-1.5 px-3 text-xs font-medium rounded-lg border transition-colors
                              ${llm.promptLanguage === lang
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-400'}
                            `}
                          >
                            {lang === 'it' ? 'Italiano' : 'English'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Dimensione chunk */}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Dimensione sezione analisi
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1000}
                          max={8000}
                          step={500}
                          value={llm.chunkSize ?? 3000}
                          onChange={(e) =>
                            setLlm((prev) => ({ ...prev, chunkSize: parseInt(e.target.value) }))
                          }
                          className="flex-1 accent-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-16 text-right">
                          {(llm.chunkSize ?? 3000).toLocaleString('it-IT')} car.
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-0.5 px-0.5">
                        <span>1.000 (prudente)</span>
                        <span>8.000 (veloce)</span>
                      </div>
                    </div>

                    {/* Prompt personalizzato */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          Prompt AI (istruzioni al modello)
                        </label>
                        <div className="flex items-center gap-2">
                          {llm.customPrompt && (
                            <button
                              onClick={() => {
                                setLlm((prev) => ({ ...prev, customPrompt: undefined }))
                                setPromptUnlocked(false)
                              }}
                              className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-600 rounded px-2 py-0.5 transition-colors"
                              title="Ripristina prompt di default"
                            >
                              <RotateCcw size={10} />
                              Ripristina default
                            </button>
                          )}
                          <button
                            onClick={() => setPromptUnlocked((v) => !v)}
                            className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${
                              promptUnlocked
                                ? 'text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50'
                                : 'text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                            title={promptUnlocked ? 'Blocca modifica prompt' : 'Sblocca modifica prompt'}
                          >
                            {promptUnlocked ? <Unlock size={10} /> : <Lock size={10} />}
                            {promptUnlocked ? 'Modifica attiva' : 'Modifica'}
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <textarea
                          className={
                            inputClass +
                            ' font-mono text-xs min-h-[140px] max-h-[320px] resize-y transition-colors' +
                            (promptUnlocked ? '' : ' cursor-not-allowed opacity-60')
                          }
                          value={llm.customPrompt ?? defaultPromptText}
                          placeholder={defaultPromptText || 'Caricamento prompt...'}
                          readOnly={!promptUnlocked}
                          onChange={(e) => {
                            if (!promptUnlocked) return
                            const val = e.target.value
                            setLlm((prev) => ({
                              ...prev,
                              customPrompt: val === defaultPromptText || val === '' ? undefined : val
                            }))
                          }}
                          spellCheck={false}
                        />
                        {!promptUnlocked && (
                          <div
                            className="absolute inset-0 flex items-center justify-center cursor-pointer rounded-lg"
                            onClick={() => setPromptUnlocked(true)}
                          >
                            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 shadow-sm">
                              <Lock size={11} />
                              Clicca "Modifica" per sbloccare
                            </span>
                          </div>
                        )}
                      </div>

                      {llm.customPrompt ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                          <Unlock size={10} />
                          Prompt personalizzato attivo — il default è stato sostituito.
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                          Prompt di default attivo.
                        </p>
                      )}
                    </div>
                  </div>
                </details>

                {/* Bottone test connessione */}
                <button
                  onClick={handleTest}
                  disabled={testState === 'loading' || !llm.baseUrl}
                  className="
                    flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border
                    border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300
                    hover:bg-slate-50 dark:hover:bg-slate-700
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
                        ? 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'}
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
      <footer className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
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
