import { LlmConfig, LlmDetectedName, LlmTestResult } from '@shared/types'

export interface LlmProviderAdapter {
  /**
   * Verifica la connessione al server e le capacità del modello.
   */
  testConnection(config: LlmConfig): Promise<LlmTestResult>

  /**
   * Elenca i modelli disponibili sul server.
   */
  listModels(config: LlmConfig): Promise<string[]>

  /**
   * Esegue l'estrazione delle entità dal testo.
   */
  detectNames(text: string, config: LlmConfig, systemPrompt: string): Promise<LlmDetectedName[]>
}
