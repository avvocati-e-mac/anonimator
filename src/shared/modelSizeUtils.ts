/**
 * Inferisce la dimensione ottimale dei chunk in base al nome del modello LLM.
 * Usato sia dal main process (nerService) che dal renderer (SettingsScreen tooltip).
 */

/**
 * Inferisce il chunkSize ottimale dal nome del modello.
 * - ≤4B (mini/small/tiny/1b/2b/3b/4b) → 1200 car.
 * - 7-8B → 2000 car.
 * - ≥13B o nome ambiguo → 3000 car. (default)
 */
export function inferChunkSize(modelName: string): number {
  const lower = modelName.toLowerCase()
  // ≤4B: llama3.2:3b, gemma:2b, phi-3-mini, phi3.5:mini, small, tiny, ecc.
  // Richiede un separatore NON-digit prima del numero per evitare falsi match su "13b"
  if (/[:\-_](?:1|2|3|4)b(?:[:\-_\s]|$)/.test(lower) ||
      /\b(mini|small|tiny)\b/.test(lower)) {
    return 1200
  }
  // 7-8B: mistral:7b, llama3.1:7b, llama3.1:8b, ecc.
  if (/[:\-_](?:7|8)b(?:[:\-_\s]|$)/.test(lower)) {
    return 2000
  }
  // Default: ≥13B o nome senza indicazione di taglia
  return 3000
}
