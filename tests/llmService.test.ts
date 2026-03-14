import { describe, it, expect, vi } from 'vitest'
import { detectNamesWithLlm } from '../src/main/services/llmService'
import { LlmConfig } from '../src/shared/types'

// Mock di electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }
}))

// Mock di fetch globale
const globalFetch = vi.fn()
vi.stubGlobal('fetch', globalFetch)

const mockConfig: LlmConfig = {
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

describe('llmService', () => {
  it('dovrebbe parsare correttamente lo structured output (replacements)', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              replacements: [
                { original: 'Mario Rossi', replacement: 'M. R.' },
                { original: 'Azienda Beta', replacement: 'A. B.' }
              ]
            })
          }
        }]
      })
    })

    const result = await detectNamesWithLlm('Il sig. Mario Rossi lavora per Azienda Beta', mockConfig)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ original: 'Mario Rossi', replacement: 'M. R.' })
  })

  it('dovrebbe fare fallback se lo structured output fallisce ma restituisce array diretto', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              { original: 'Mario Rossi', replacement: 'M. R.' }
            ])
          }
        }]
      })
    })

    const result = await detectNamesWithLlm('Test', mockConfig)
    expect(result).toHaveLength(1)
    expect(result[0].original).toBe('Mario Rossi')
  })

  it('dovrebbe filtrare i falsi positivi (date, n. fascicolo)', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              replacements: [
                { original: 'Mario Rossi', replacement: 'M. R.' },
                { original: '12/05/2023', replacement: 'DATA' },
                { original: 'n. 123/2022', replacement: 'Rif' }
              ]
            })
          }
        }]
      })
    })

    const result = await detectNamesWithLlm('Test', mockConfig)
    expect(result).toHaveLength(1)
    expect(result[0].original).toBe('Mario Rossi')
  })

  it('dovrebbe restituire array vuoto in caso di errore server senza rompere il flusso', async () => {
    globalFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    })

    const result = await detectNamesWithLlm('Test', mockConfig)
    expect(result).toEqual([])
  })

  it('dovrebbe includere stream:false in ogni corpo richiesta (OpenAI compat)', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ replacements: [] }) } }]
      })
    })

    await detectNamesWithLlm('Test', mockConfig)
    const body = JSON.parse(globalFetch.mock.calls[0][1].body as string)
    expect(body.stream).toBe(false)
  })

  it('dovrebbe includere stream:false in ogni corpo richiesta (Ollama)', async () => {
    const ollamaConfig: LlmConfig = {
      ...mockConfig,
      providerType: 'ollama',
      providerPreset: 'ollama',
      baseUrl: 'http://localhost:11434/v1'
    }

    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({ replacements: [] }) }
      })
    })

    await detectNamesWithLlm('Test', ollamaConfig)
    const body = JSON.parse(globalFetch.mock.calls[0][1].body as string)
    expect(body.stream).toBe(false)
  })
})
