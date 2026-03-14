import { describe, it, expect } from 'vitest'
import { inferChunkSize } from '../src/shared/modelSizeUtils'

describe('inferChunkSize', () => {
  // ≤4B → 1200
  it('phi-3-mini → 1200', () => expect(inferChunkSize('phi-3-mini')).toBe(1200))
  it('phi3.5:mini → 1200', () => expect(inferChunkSize('phi3.5:mini')).toBe(1200))
  it('llama3.2:3b → 1200', () => expect(inferChunkSize('llama3.2:3b')).toBe(1200))
  it('gemma:2b → 1200', () => expect(inferChunkSize('gemma:2b')).toBe(1200))
  it('qwen2.5:3b → 1200', () => expect(inferChunkSize('qwen2.5:3b')).toBe(1200))
  it('tiny-llm → 1200', () => expect(inferChunkSize('tiny-llm')).toBe(1200))
  it('small-model → 1200', () => expect(inferChunkSize('small-model')).toBe(1200))

  // 7-8B → 2000
  it('mistral:7b → 2000', () => expect(inferChunkSize('mistral:7b')).toBe(2000))
  it('llama3.1:7b → 2000', () => expect(inferChunkSize('llama3.1:7b')).toBe(2000))
  it('llama3.1:8b → 2000', () => expect(inferChunkSize('llama3.1:8b')).toBe(2000))
  it('mistral-7b-instruct → 2000', () => expect(inferChunkSize('mistral-7b-instruct')).toBe(2000))

  // ≥13B o ambiguo → 3000
  it('llama3.1:13b → 3000', () => expect(inferChunkSize('llama3.1:13b')).toBe(3000))
  it('llama3.1:70b → 3000', () => expect(inferChunkSize('llama3.1:70b')).toBe(3000))
  it('my-custom-model → 3000', () => expect(inferChunkSize('my-custom-model')).toBe(3000))
  it('llama3.2 (senza taglia) → 3000', () => expect(inferChunkSize('llama3.2')).toBe(3000))
  it('stringa vuota → 3000', () => expect(inferChunkSize('')).toBe(3000))
})
