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
  chunkMode: 'chunk',
  stream: false,
  temperature: 0
}

describe('analyzeText — page-mode LLM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(detectNamesWithLlm).mockResolvedValue([])
  })

  it('con chunkMode=page e pages presenti, chiama detectNamesWithLlm N volte (una per pagina)', async () => {
    // Le pagine devono essere > 50 caratteri per non essere filtrate
    const pages = [
      'Pagina uno con testo sufficientemente lungo per passare il filtro minimo',
      'Pagina due con testo sufficientemente lungo per passare il filtro minimo',
      'Pagina tre con testo sufficientemente lungo per passare il filtro minimo'
    ]
    const config: LlmConfig = { ...baseLlmConfig, chunkMode: 'page' }

    await analyzeText('testo completo', config, undefined, pages)

    expect(detectNamesWithLlm).toHaveBeenCalledTimes(pages.length)
  })

  it('con chunkMode=page ma pages assente, fa fallback a chunking senza errori', async () => {
    const config: LlmConfig = { ...baseLlmConfig, chunkMode: 'page', chunkSize: 3000 }
    const text = 'Testo breve senza pagine separate.'

    await expect(analyzeText(text, config, undefined, undefined)).resolves.not.toThrow()
    // Con testo breve, viene chiamato una volta (un unico chunk)
    expect(detectNamesWithLlm).toHaveBeenCalledTimes(1)
  })

  it('con chunkMode=page e pages assente (array vuoto), fa fallback a chunking', async () => {
    const config: LlmConfig = { ...baseLlmConfig, chunkMode: 'page' }
    const text = 'Testo breve.'

    await analyzeText(text, config, undefined, [])
    // Fallback a chunk → una chiamata per il testo breve
    expect(detectNamesWithLlm).toHaveBeenCalledTimes(1)
  })

  it('con chunkMode=page e una pagina che supera chunkSize, la pagina viene spezzata', async () => {
    const config: LlmConfig = { ...baseLlmConfig, chunkMode: 'page', chunkSize: 50 }
    // Pagina molto lunga (> 50 char), dovrebbe essere spezzata in più chunk
    const longPage = 'A'.repeat(200)
    const pages = [longPage]

    await analyzeText('full text', config, undefined, pages)

    // Deve essere chiamato più volte (la pagina è stata spezzata)
    expect(detectNamesWithLlm.mock.calls.length).toBeGreaterThan(1)
  })

  it('con chunkMode=chunk (default), ignora pages e usa chunking fisso', async () => {
    const pages = ['Pagina uno', 'Pagina due', 'Pagina tre']
    const config: LlmConfig = { ...baseLlmConfig, chunkMode: 'chunk', chunkSize: 3000 }
    const text = 'Testo breve.'

    await analyzeText(text, config, undefined, pages)

    // chunkMode=chunk → 1 chiamata (tutto il testo in un unico chunk)
    expect(detectNamesWithLlm).toHaveBeenCalledTimes(1)
  })
})
