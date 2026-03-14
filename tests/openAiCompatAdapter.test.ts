import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAiCompatAdapter } from '../src/main/services/llm/providers/OpenAiCompatAdapter'
import type { LlmConfig } from '../src/shared/types'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const globalFetch = vi.fn()
vi.stubGlobal('fetch', globalFetch)

const mockConfig: LlmConfig = {
  enabled: true,
  providerType: 'openai_compat',
  providerPreset: 'lmstudio',
  baseUrl: 'http://localhost:1234/v1',
  model: 'mistral',
  maxTokens: 1000,
  timeoutMs: 5000,
  parallelRequests: 1,
  promptLanguage: 'it',
  chunkSize: 3000,
  stream: false,
  temperature: 0
}

const adapter = new OpenAiCompatAdapter()

function makeOkResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }]
    })
  }
}

describe('OpenAiCompatAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listModels', () => {
    it('dovrebbe restituire i modelli nel formato OpenAI { data: [{ id }] }', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'mistral' }, { id: 'llama3' }] })
      })

      const result = await adapter.listModels(mockConfig)
      expect(result).toEqual(['mistral', 'llama3'])
    })

    it('dovrebbe restituire [] se la risposta non è ok', async () => {
      globalFetch.mockResolvedValue({ ok: false, status: 404 })

      const result = await adapter.listModels(mockConfig)
      expect(result).toEqual([])
    })

    it('dovrebbe aggiungere /v1 all\'URL base se manca', async () => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'mistral' }] })
      })

      await adapter.listModels({ ...mockConfig, baseUrl: 'http://localhost:1234' })
      const calledUrl = globalFetch.mock.calls[0][0] as string
      expect(calledUrl).toBe('http://localhost:1234/v1/models')
    })
  })

  describe('detectNames — fallback 400 → json_object', () => {
    it('dovrebbe ritentare con json_object se il primo attempt restituisce 400', async () => {
      // Prima chiamata: 400
      globalFetch
        .mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request' })
        // Seconda chiamata: ok con json_object
        .mockResolvedValueOnce(makeOkResponse(JSON.stringify({
          replacements: [{ original: 'Mario Rossi', replacement: 'M. R.' }]
        })))

      const result = await adapter.detectNames('Testo', mockConfig, 'prompt')
      expect(result).toHaveLength(1)
      expect(result[0].original).toBe('Mario Rossi')
      expect(globalFetch).toHaveBeenCalledTimes(2)

      // Il secondo body deve avere response_format: json_object
      const secondBody = JSON.parse(globalFetch.mock.calls[1][1].body as string)
      expect(secondBody.response_format).toEqual({ type: 'json_object' })
    })
  })

  describe('detectNames — markdown code fence stripping', () => {
    it('dovrebbe estrarre il JSON anche se il modello avvolge la risposta in un code fence', async () => {
      const fencedContent = '```json\n{"replacements":[{"original":"Luca Bianchi","replacement":"L. B."}]}\n```'
      globalFetch.mockResolvedValue(makeOkResponse(fencedContent))

      const result = await adapter.detectNames('Testo', mockConfig, 'prompt')
      expect(result).toHaveLength(1)
      expect(result[0].original).toBe('Luca Bianchi')
    })

    it('dovrebbe gestire code fence senza il tag json', async () => {
      const fencedContent = '```\n{"replacements":[{"original":"Anna Verdi","replacement":"A. V."}]}\n```'
      globalFetch.mockResolvedValue(makeOkResponse(fencedContent))

      const result = await adapter.detectNames('Testo', mockConfig, 'prompt')
      expect(result).toHaveLength(1)
      expect(result[0].original).toBe('Anna Verdi')
    })
  })

  describe('detectNames — array diretto senza chiave replacements', () => {
    it('dovrebbe accettare un array JSON diretto come risposta', async () => {
      globalFetch.mockResolvedValue(makeOkResponse(
        JSON.stringify([{ original: 'Mario Rossi', replacement: 'M. R.' }])
      ))

      const result = await adapter.detectNames('Testo', mockConfig, 'prompt')
      expect(result).toHaveLength(1)
      expect(result[0].original).toBe('Mario Rossi')
    })
  })

  describe('detectNames — stream:false e temperature:0', () => {
    it('dovrebbe inviare stream:false e temperature:0 in ogni richiesta', async () => {
      globalFetch.mockResolvedValue(makeOkResponse(JSON.stringify({ replacements: [] })))

      await adapter.detectNames('Testo', mockConfig, 'prompt')
      const body = JSON.parse(globalFetch.mock.calls[0][1].body as string)
      expect(body.stream).toBe(false)
      expect(body.temperature).toBe(0)
    })
  })
})
