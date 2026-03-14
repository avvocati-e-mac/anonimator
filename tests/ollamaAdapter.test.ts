import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaAdapter } from '../src/main/services/llm/providers/OllamaAdapter'
import type { LlmConfig } from '../src/shared/types'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const globalFetch = vi.fn()
vi.stubGlobal('fetch', globalFetch)

const mockConfig: LlmConfig = {
  enabled: true,
  providerType: 'ollama',
  providerPreset: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.2',
  maxTokens: 1000,
  timeoutMs: 5000,
  parallelRequests: 1,
  promptLanguage: 'it',
  chunkSize: 3000,
  stream: false,
  temperature: 0
}

const adapter = new OllamaAdapter()

describe('OllamaAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listModels', () => {
    it('dovrebbe restituire i nomi dei modelli da una risposta /api/tags valida', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'mistral' }] })
      })

      const result = await adapter.listModels(mockConfig)
      expect(result).toEqual(['llama3.2', 'mistral'])
      expect(globalFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.anything()
      )
    })

    it('dovrebbe restituire [] se la risposta HTTP non è ok', async () => {
      globalFetch.mockResolvedValue({ ok: false, status: 503 })

      const result = await adapter.listModels(mockConfig)
      expect(result).toEqual([])
    })

    it('dovrebbe restituire [] in caso di timeout/errore di rete', async () => {
      globalFetch.mockRejectedValue(new Error('TimeoutError'))

      const result = await adapter.listModels(mockConfig)
      expect(result).toEqual([])
    })

    it('dovrebbe normalizzare baseUrl rimuovendo /v1', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2' }] })
      })

      await adapter.listModels({ ...mockConfig, baseUrl: 'http://localhost:11434/v1' })
      const calledUrl = globalFetch.mock.calls[0][0] as string
      expect(calledUrl).toBe('http://localhost:11434/api/tags')
    })
  })

  describe('testConnection', () => {
    it('dovrebbe restituire ok:true se il modello è presente', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'mistral' }] })
      })

      const result = await adapter.testConnection(mockConfig)
      expect(result.ok).toBe(true)
      expect(result.models).toContain('llama3.2')
    })

    it('dovrebbe restituire ok:false se il modello non è presente', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'mistral' }] })
      })

      const result = await adapter.testConnection({ ...mockConfig, model: 'llama3.2' })
      expect(result.ok).toBe(false)
      expect(result.message).toContain('llama3.2')
    })

    it('dovrebbe restituire ok:false se nessun modello è trovato', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] })
      })

      const result = await adapter.testConnection(mockConfig)
      expect(result.ok).toBe(false)
    })

    it('dovrebbe restituire ok:false se il server non è raggiungibile', async () => {
      // listModels swallows network errors and returns [], quindi testConnection
      // vede una lista vuota — comunque ok:false
      globalFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await adapter.testConnection(mockConfig)
      expect(result.ok).toBe(false)
    })
  })

  describe('detectNames', () => {
    it('dovrebbe restituire le entità da uno structured output valido', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              replacements: [
                { original: 'Mario Rossi', replacement: 'M. R.' }
              ]
            })
          }
        })
      })

      const result = await adapter.detectNames('Il sig. Mario Rossi', mockConfig, 'sistema prompt')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ original: 'Mario Rossi', replacement: 'M. R.' })
    })

    it('dovrebbe restituire [] se content è vuoto', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: '' } })
      })

      const result = await adapter.detectNames('Testo', mockConfig, 'sistema prompt')
      expect(result).toEqual([])
    })

    it('dovrebbe lanciare un errore in caso di HTTP error', async () => {
      globalFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })

      await expect(
        adapter.detectNames('Testo', mockConfig, 'sistema prompt')
      ).rejects.toThrow()
    })

    it('dovrebbe verificare che stream:false sia presente nel body della richiesta', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: JSON.stringify({ replacements: [] }) } })
      })

      await adapter.detectNames('Testo', mockConfig, 'sistema prompt')
      const body = JSON.parse(globalFetch.mock.calls[0][1].body as string)
      expect(body.stream).toBe(false)
    })
  })
})
