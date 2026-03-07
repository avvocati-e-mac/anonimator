import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import log from 'electron-log'
import type { LlmConfig } from '@shared/types'
import { DEFAULT_LLM_CONFIG } from '@shared/types'

/**
 * Persistenza configurazione su disco in JSON.
 * File: <userData>/legalshield-settings.json
 * Non contiene mai dati di documenti — solo preferenze UI e configurazione LLM.
 */

interface AppSettings {
  llm: LlmConfig
}

const DEFAULT_SETTINGS: AppSettings = {
  llm: DEFAULT_LLM_CONFIG
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'legalshield-settings.json')
}

function load(): AppSettings {
  const p = getSettingsPath()
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_LLM_CONFIG } }
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      llm: { ...DEFAULT_LLM_CONFIG, ...(parsed.llm ?? {}) }
    }
  } catch (err) {
    log.warn('settingsManager: errore lettura settings, uso default', { err })
    return { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_LLM_CONFIG } }
  }
}

function save(settings: AppSettings): void {
  const p = getSettingsPath()
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    log.error('settingsManager: errore scrittura settings', { err })
  }
}

export const settingsManager = {
  getLlmConfig(): LlmConfig {
    return load().llm
  },

  setLlmConfig(config: LlmConfig): void {
    const current = load()
    save({ ...current, llm: config })
    log.info('settingsManager: LLM config aggiornata', {
      enabled: config.enabled,
      model: config.model,
      promptLanguage: config.promptLanguage,
      hasCustomPrompt: !!config.customPrompt,
      chunkSize: config.chunkSize
    })
  }
}
