import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { app } from 'electron'
import { settingsManager } from '../src/main/services/settingsManager'

// Mock di electron
vi.mock('electron', () => {
  const userData = join(tmpdir(), 'anonimator-test-' + Math.random().toString(36).slice(2))
  mkdirSync(userData, { recursive: true })
  return {
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return userData
        return '/tmp'
      }
    }
  }
})

describe('settingsManager migration', () => {
  it('dovrebbe migrare una vecchia config Ollama', () => {
    const oldConfig = {
      llm: {
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
        maxTokens: 4096,
        timeoutMs: 60000,
        parallelRequests: 1
      }
    }

    const configPath = join(app.getPath('userData'), 'legalshield-settings.json')
    writeFileSync(configPath, JSON.stringify(oldConfig))

    const config = settingsManager.getLlmConfig()
    expect(config.providerType).toBe('ollama')
    expect(config.providerPreset).toBe('ollama')
    expect(config.model).toBe('llama3.2')
    expect(config.stream).toBe(false)
    expect(config.temperature).toBe(0)
  })

  it('dovrebbe migrare una vecchia config LM Studio', () => {
    const oldConfig = {
      llm: {
        enabled: true,
        baseUrl: 'http://localhost:1234/v1',
        model: 'mistral',
        maxTokens: 4096,
        timeoutMs: 60000,
        parallelRequests: 1
      }
    }

    const configPath = join(app.getPath('userData'), 'legalshield-settings.json')
    writeFileSync(configPath, JSON.stringify(oldConfig))

    const config = settingsManager.getLlmConfig()
    expect(config.providerType).toBe('openai_compat')
    expect(config.providerPreset).toBe('lmstudio')
    expect(config.model).toBe('mistral')
  })
})
