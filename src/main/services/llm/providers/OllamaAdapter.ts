import log from 'electron-log'
import { LlmConfig, LlmDetectedName, LlmTestResult } from '@shared/types'
import { LlmProviderAdapter } from './LlmProviderAdapter'
import { REPLACEMENT_JSON_SCHEMA } from '../schemas'

export class OllamaAdapter implements LlmProviderAdapter {
  private normalizeUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  }

  async listModels(config: LlmConfig): Promise<string[]> {
    const url = `${this.normalizeUrl(config.baseUrl)}/api/tags`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs) })
      if (!response.ok) return []
      const json = await response.json() as { models?: { name: string }[] }
      return (json.models ?? []).map(m => m.name)
    } catch (err) {
      log.warn('OllamaAdapter: errore listModels', err)
      return []
    }
  }

  async testConnection(config: LlmConfig): Promise<LlmTestResult> {
    try {
      const models = await this.listModels(config)
      if (models.length === 0) {
        return { ok: false, message: 'Server Ollama raggiungibile ma nessun modello trovato.' }
      }

      const hasModel = config.model ? models.includes(config.model) : true
      const capabilities = {
        supportsStructuredOutput: true, // Ollama >= 0.5.0 supporta JSON schema
        supportsJsonSchema: true,
        supportsModelListing: true
      }

      if (config.model && !hasModel) {
        return {
          ok: false,
          message: `Modello "${config.model}" non trovato su Ollama.`,
          models,
          capabilities
        }
      }

      return {
        ok: true,
        message: 'Connessione a Ollama riuscita.',
        models,
        capabilities
      }
    } catch (err) {
      return { ok: false, message: `Errore connessione Ollama: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async detectNames(text: string, config: LlmConfig, systemPrompt: string): Promise<LlmDetectedName[]> {
    const url = `${this.normalizeUrl(config.baseUrl)}/api/chat`

    // Tentativo con structured output (Ollama 0.5.0+)
    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      stream: false,
      format: REPLACEMENT_JSON_SCHEMA,
      options: {
        temperature: 0,
        num_predict: config.maxTokens
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs)
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
      }

      const json = await response.json() as { message?: { content?: string } }
      const content = json.message?.content ?? ''

      if (!content) return []

      try {
        const parsed = JSON.parse(content) as { replacements?: LlmDetectedName[] }
        return parsed.replacements ?? []
      } catch (err) {
        log.warn('OllamaAdapter: errore parsing JSON structured output', { content, err })
        return []
      }
    } catch (err) {
      log.error('OllamaAdapter: errore detectNames', err)
      throw err
    }
  }
}
