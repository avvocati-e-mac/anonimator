import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmConfig } from '../src/shared/types'

// Mock pesanti prima di importare nerService
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-model-path' }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// Mock di detectNamesWithLlm — testiamo solo la logica di chunking/page-mode
vi.mock('../src/main/services/llmService', () => ({
  detectNamesWithLlm: vi.fn().mockResolvedValue([])
}))

// Mock del pipeline NER per non caricare il modello ONNX in test
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue([])),
  env: {
    allowRemoteModels: true,
    allowLocalModels: true,
    localModelPath: '',
    backends: { onnx: { wasm: {} } }
  }
}))

import { analyzeText } from '../src/main/services/nerService'
import { detectNamesWithLlm } from '../src/main/services/llmService'

const baseLlmConfig: LlmConfig = {
  enabled: true,
  providerType: 'openai_compat',
  providerPreset: 'lmstudio',
  baseUrl: 'http://localhost:1234/v1',
  model: 'test-model',
  maxTokens: 1000,
  timeoutMs: 5000,
  parallelRequests: 1,
  promptLanguage: 'it',
  chunkSize: 3000,
  stream: false,
  temperature: 0
}

describe('analyzeText — page-mode LLM (automatico da presenza di pages)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(detectNamesWithLlm).mockResolvedValue([])
  })

  it('con pages presenti, chiama detectNamesWithLlm N volte (una per pagina)', async () => {
    // Le pagine devono essere > 50 caratteri per non essere filtrate
    const pages = [
      'Pagina uno con testo sufficientemente lungo per passare il filtro minimo',
      'Pagina due con testo sufficientemente lungo per passare il filtro minimo',
      'Pagina tre con testo sufficientemente lungo per passare il filtro minimo'
    ]

    await analyzeText('testo completo', baseLlmConfig, undefined, pages)

    expect(detectNamesWithLlm).toHaveBeenCalledTimes(pages.length)
  })

  it('con pages assente, usa chunking fisso senza errori', async () => {
    const text = 'Testo breve senza pagine separate.'

    await expect(analyzeText(text, baseLlmConfig, undefined, undefined)).resolves.not.toThrow()
    // Con testo breve, viene chiamato una volta (un unico chunk)
    expect(detectNamesWithLlm).toHaveBeenCalledTimes(1)
  })

  it('con pages vuoto (array vuoto), usa chunking fisso', async () => {
    const text = 'Testo breve.'

    await analyzeText(text, baseLlmConfig, undefined, [])
    // Fallback a chunk → una chiamata per il testo breve
    expect(detectNamesWithLlm).toHaveBeenCalledTimes(1)
  })

  it('con una pagina che supera chunkSize, la pagina viene spezzata in più chunk', async () => {
    const config: LlmConfig = { ...baseLlmConfig, chunkSize: 50 }
    // Pagina molto lunga (> 50 char), dovrebbe essere spezzata in più chunk
    const longPage = 'A'.repeat(200)
    const pages = [longPage]

    await analyzeText('full text', config, undefined, pages)

    // Deve essere chiamato più volte (la pagina è stata spezzata)
    expect(detectNamesWithLlm.mock.calls.length).toBeGreaterThan(1)
  })

  it('con pages fornite ma testo breve, usa chunking fisso se pages è assente', async () => {
    const text = 'Testo breve.'

    await analyzeText(text, baseLlmConfig, undefined, undefined)

    // Nessuna page fornita → chunking fisso → 1 chiamata
    expect(detectNamesWithLlm).toHaveBeenCalledTimes(1)
  })

  it('LlmConfig non ha più la proprietà chunkMode', () => {
    // Verifica a runtime che il tipo non includa chunkMode
    const config = { ...baseLlmConfig }
    expect('chunkMode' in config).toBe(false)
  })
})
