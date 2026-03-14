import { z } from 'zod'

/**
 * JSON Schema (plain object) per lo structured output LLM.
 * Usato da OllamaAdapter (campo `format`) e OpenAiCompatAdapter (campo `response_format.json_schema.schema`).
 */
export const REPLACEMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    replacements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' }
        },
        required: ['original', 'replacement']
      }
    }
  },
  required: ['replacements']
} as const

/**
 * Schema Zod per la validazione della risposta LLM.
 */
export const LlmReplacementsResponseSchema = z.object({
  replacements: z.array(
    z.object({
      original: z.string().min(1),
      replacement: z.string().min(1)
    })
  )
})
