import log from 'electron-log'
import { LlmConfig, LlmDetectedName, LlmTestResult } from '@shared/types'
import { LlmProviderAdapter } from './LlmProviderAdapter'
import { REPLACEMENT_JSON_SCHEMA } from '../schemas'

type ResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: object } }
  | { type: 'json_object' }

interface OpenAiChatRequest {
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  stream: boolean
  temperature: number
  max_tokens: number
  response_format?: ResponseFormat
}

export class OpenAiCompatAdapter implements LlmProviderAdapter {
  private normalizeUrl(baseUrl: string): string {
    const url = baseUrl.replace(/\/+$/, '')
    if (!url.endsWith('/v1')) return url + '/v1'
    return url
  }

  async listModels(config: LlmConfig): Promise<string[]> {
    const url = `${this.normalizeUrl(config.baseUrl)}/models`
    try {
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer not-needed' },
        signal: AbortSignal.timeout(config.timeoutMs)
      })
      if (!response.ok) return []
      const json = await response.json() as { data?: { id: string }[] }
      return (json.data ?? []).map(m => m.id)
    } catch (err) {
      log.warn('OpenAiCompatAdapter: errore listModels', err)
      return []
    }
  }

  async testConnection(config: LlmConfig): Promise<LlmTestResult> {
    try {
      const models = await this.listModels(config)
      const capabilities = {
        supportsStructuredOutput: true, // Preset tipici come LM Studio supportano json_schema; fallback gestito in detectNames
        supportsJsonSchema: true,
        supportsModelListing: true
      }

      if (models.length === 0) {
        return { ok: false, message: 'Server raggiungibile ma non è stato possibile elencare i modelli.', capabilities }
      }

      const hasModel = config.model ? models.includes(config.model) : true

      if (config.model && !hasModel) {
        return {
          ok: false,
          message: `Modello "${config.model}" non trovato.`,
          models,
          capabilities
        }
      }

      return {
        ok: true,
        message: 'Connessione riuscita (OpenAI-compatible).',
        models,
        capabilities
      }
    } catch (err) {
      return { ok: false, message: `Errore connessione: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async detectNames(text: string, config: LlmConfig, systemPrompt: string): Promise<LlmDetectedName[]> {
    const url = `${this.normalizeUrl(config.baseUrl)}/chat/completions`

    const body: OpenAiChatRequest = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      stream: false,
      temperature: 0,
      max_tokens: config.maxTokens,
      // LM Studio e altri server moderni supportano json_schema
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'anonymization_result',
          strict: false, // Alcuni server locali falliscono con strict: true
          schema: REPLACEMENT_JSON_SCHEMA
        }
      }
    }

    try {
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not-needed'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs)
      })

      // Se fallisce con response_format (es. MLX server vecchi), riprova con json_mode semplice
      if (!response.ok && response.status === 400) {
        log.warn('OpenAiCompatAdapter: structured output fallito (400), riprovo con json_mode')
        body.response_format = { type: 'json_object' }
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer not-needed'
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs)
        })
      }

      if (!response.ok) {
        throw new Error(`OpenAI compat error: ${response.status} ${response.statusText}`)
      }

      const json = await response.json() as { choices?: { message?: { content?: string } }[] }
      const content = json.choices?.[0]?.message?.content ?? ''

      if (!content) return []

      return this.parseStructuredContent(content)
    } catch (err) {
      log.error('OpenAiCompatAdapter: errore detectNames', err)
      throw err
    }
  }

  private parseStructuredContent(content: string): LlmDetectedName[] {
    try {
      // Pulisce markdown se presente (anche se abbiamo chiesto JSON)
      const cleanJson = content.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '')
      const parsed = JSON.parse(cleanJson) as unknown

      // Caso 1: oggetto con chiave "replacements"
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).replacements)) {
        return (parsed as { replacements: LlmDetectedName[] }).replacements
      }

      // Caso 2: array diretto
      if (Array.isArray(parsed)) {
        return parsed as LlmDetectedName[]
      }

      return []
    } catch (err) {
      log.warn('OpenAiCompatAdapter: errore parsing JSON', { content, err })
      return []
    }
  }
}
