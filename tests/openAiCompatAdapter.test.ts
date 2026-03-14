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

function make400Response(body = 'response_format not supported') {
  const obj = {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: async () => body,
    clone: () => ({ text: async () => body })
  }
  return obj
}

function make400ContextOverflow(msg = 'Context size has been exceeded') {
  return make400Response(msg)
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
    it('dovrebbe ritentare con json_object se il primo attempt restituisce 400 (format non supportato)', async () => {
      globalFetch
        .mockResolvedValueOnce(make400Response('response_format not supported'))
        .mockResolvedValueOnce(makeOkResponse(JSON.stringify({
          replacements: [{ original: 'Mario Rossi', replacement: 'M. R.' }]
        })))

      const result = await adapter.detectNames('Testo', mockConfig, 'prompt')
      expect(result).toHaveLength(1)
      expect(result[0].original).toBe('Mario Rossi')
      expect(globalFetch).toHaveBeenCalledTimes(2)

      const secondBody = JSON.parse(globalFetch.mock.calls[1][1].body as string)
      expect(secondBody.response_format).toEqual({ type: 'json_object' })
    })

    it('dovrebbe ritentare senza response_format se anche json_object restituisce 400 (es. Phi 3B)', async () => {
      globalFetch
        .mockResolvedValueOnce(make400Response('response_format not supported'))
        .mockResolvedValueOnce(make400Response('json_object not supported'))
        .mockResolvedValueOnce(makeOkResponse(JSON.stringify({
          replacements: [{ original: 'Luca Neri', replacement: 'L. N.' }]
        })))

      const result = await adapter.detectNames('Testo', mockConfig, 'prompt')
      expect(result).toHaveLength(1)
      expect(result[0].original).toBe('Luca Neri')
      expect(globalFetch).toHaveBeenCalledTimes(3)

      // Il terzo tentativo non deve avere response_format
      const thirdBody = JSON.parse(globalFetch.mock.calls[2][1].body as string)
      expect(thirdBody.response_format).toBeUndefined()
    })
  })

  describe('detectNames — bail immediato su context overflow', () => {
    it('dovrebbe lanciare subito un errore (senza retry) se il primo 400 indica context overflow', async () => {
      globalFetch.mockResolvedValueOnce(make400ContextOverflow('Context size has been exceeded'))

      await expect(adapter.detectNames('Testo', mockConfig, 'prompt'))
        .rejects.toThrow(/context overflow/i)

      // Nessun secondo tentativo
      expect(globalFetch).toHaveBeenCalledTimes(1)
    })

    it('dovrebbe lanciare subito un errore se il secondo 400 indica context overflow', async () => {
      globalFetch
        .mockResolvedValueOnce(make400Response('response_format not supported'))
        .mockResolvedValueOnce(make400ContextOverflow('context_length_exceeded'))

      await expect(adapter.detectNames('Testo', mockConfig, 'prompt'))
        .rejects.toThrow(/context overflow/i)

      // Solo due tentativi, non tre
      expect(globalFetch).toHaveBeenCalledTimes(2)
    })

    it('dovrebbe rilevare "maximum context length" come overflow', async () => {
      globalFetch.mockResolvedValueOnce(make400ContextOverflow('maximum context length is 4096 tokens'))

      await expect(adapter.detectNames('Testo', mockConfig, 'prompt'))
        .rejects.toThrow(/context overflow/i)
      expect(globalFetch).toHaveBeenCalledTimes(1)
    })

    it('dovrebbe rilevare "prompt is too long" come overflow', async () => {
      globalFetch.mockResolvedValueOnce(make400ContextOverflow('prompt is too long for this model'))

      await expect(adapter.detectNames('Testo', mockConfig, 'prompt'))
        .rejects.toThrow(/context overflow/i)
      expect(globalFetch).toHaveBeenCalledTimes(1)
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
