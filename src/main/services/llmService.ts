import log from 'electron-log'
import { z } from 'zod'
import { LlmConfig, LlmDetectedName, LlmTestResult } from '@shared/types'
import { OllamaAdapter } from './llm/providers/OllamaAdapter'
import { OpenAiCompatAdapter } from './llm/providers/OpenAiCompatAdapter'
import { LlmProviderAdapter } from './llm/providers/LlmProviderAdapter'

// Stopword italiane che non devono mai essere trattate come nomi
const ITALIAN_STOPWORDS = new Set([
  'di', 'de', 'del', 'della', 'dello', 'delle', 'degli', 'dei',
  'da', 'dal', 'dalla', 'dallo', 'dalle', 'dagli', 'dai',
  'in', 'nel', 'nella', 'nello', 'nelle', 'negli', 'nei',
  'a', 'al', 'alla', 'allo', 'alle', 'agli', 'ai',
  'su', 'sul', 'sulla', 'sullo', 'sulle', 'sugli', 'sui',
  'con', 'per', 'tra', 'fra',
  'il', 'lo', 'la', 'le', 'gli', 'i', 'un', 'una', 'uno',
  'detto', 'detta', 'detti', 'dette', 'sotto', 'sopra', 'dopo',
  'prima', 'come', 'quale', 'quali', 'che', 'chi', 'cui',
  'non', 'se', 'più', 'anche', 'già', 'solo', 'sono',
])

// Prompt ottimizzato per compatibilità con modelli da 3B parametri (~35% più corto).
// Unica versione usata sia per promptLanguage='it' che 'en': l'inglese funziona meglio
// su modelli piccoli multilingua rispetto all'italiano per istruzioni di sistema.
const OPTIMIZED_NER_PROMPT = `Return JSON: {"replacements": [{"original": "...", "replacement": "..."}]}

Extract ONLY names of natural persons and private companies from Italian legal text.

PERSONS — first + last name (or last name alone if clearly a person).
Replace each word with its initial + dot.
"Mario Ferrari" → "M. F."
"Dott. Anna Maria Verdi" → "A. M. V."
"BIANCHI MARCO" → "B. M."
"D'AMICO LUIGI" → "L. D."  ← apostrophe is part of the surname, do not split

PRIVATE COMPANIES — name words + legal suffix.
Replace each name word with its initial, keep the legal suffix unchanged.
"Alfa S.r.l." → "A. S.r.l."
"ACMEPEC S.P.A." → "A. S.P.A."
"Studio Legale Rossi" → "S. L. R."

DO NOT extract:
- Public bodies: Tribunale, Corte, Ministero, Comune, INPS, Regione, Repubblica, Stato
- Court names: "Corte d'Appello", "Corte di Cassazione", "SECONDA SEZIONE CIVILE"
- Laws and articles: "art. 3", "D.M. 10/3/2014 n. 55", "L. 247/2012", "C.C.", "C.P.C."
- Dates and case refs: "Ud. 16/03/2023", "n. 15992/2022", "Cass. 4142/2017"
- Job titles used alone: "il Giudice", "Consigliere", "Rel. Consigliere"
- Phrases longer than 4 words
- Single common words that are not proper names
- Certificate metadata: "Firmato Da:", "Emesso Da:", "Serial#:", "Numero registro"

Rule: if a field mixes name and role (e.g. "Dott. MARCO BIANCHI - Consigliere -"),
extract ONLY the name ("MARCO BIANCHI").

If nothing found: {"replacements": []}`

export const SYSTEM_PROMPT_IT = OPTIMIZED_NER_PROMPT
export const SYSTEM_PROMPT_EN = OPTIMIZED_NER_PROMPT

// Pattern che indicano falsi positivi tipici dei modelli piccoli
const SPURIOUS_PATTERNS = [
  /\d{2}[\/-]\d{2}[\/-]\d{2,4}/,
  /\bn\.\s*\d+/i,
  /\b(ric\.|sez\.|ud\.|art\.|d\.m\.|d\.lgs\.|legge\s+\d)/i,
  /[-–]\s*(presidente|consigliere|relatore|ricorrente|appellante|resistente|equa\s+riparazione)/i,
  /\b(20\d{2}|19\d{2})\b/,
]

function isValidReplacement(original: string): boolean {
  const trimmed = original.trim()
  const lower = trimmed.toLowerCase()
  if (ITALIAN_STOPWORDS.has(lower)) return false
  if (trimmed.length <= 2) return false
  const firstWord = lower.split(/\s+/)[0]
  if (ITALIAN_STOPWORDS.has(firstWord)) return false
  for (const pat of SPURIOUS_PATTERNS) {
    if (pat.test(trimmed)) return false
  }
  if (trimmed.split(/\s+/).length > 6) return false
  return true
}

function getAdapter(config: LlmConfig): LlmProviderAdapter {
  if (config.providerType === 'ollama') {
    return new OllamaAdapter()
  }
  return new OpenAiCompatAdapter()
}

const LlmDetectedNameSchema = z.object({
  original: z.string().min(1),
  replacement: z.string().min(1)
})

/**
 * Chiama il server LLM locale per rilevare nomi e organizzazioni nel testo.
 */
export async function detectNamesWithLlm(
  text: string,
  config: LlmConfig
): Promise<LlmDetectedName[]> {
  const adapter = getAdapter(config)

  const systemPrompt = config.customPrompt?.trim()
    ? config.customPrompt.trim()
    : config.promptLanguage === 'en'
      ? SYSTEM_PROMPT_EN
      : SYSTEM_PROMPT_IT

  try {
    const rawNames = await adapter.detectNames(text, config, systemPrompt)

    // Validazione finale con Zod e logica locale
    const validatedNames = rawNames
      .filter(r => {
        const parsed = LlmDetectedNameSchema.safeParse(r)
        return parsed.success && isValidReplacement(parsed.data.original)
      })
      .map(r => LlmDetectedNameSchema.parse(r))

    log.info('llmService: nomi rilevati e validati', {
      raw: rawNames.length,
      validated: validatedNames.length,
      provider: config.providerType,
      preset: config.providerPreset
    })

    return validatedNames
  } catch (err) {
    log.error('llmService: errore durante detectNamesWithLlm', err)
    // Non rilanciamo l'errore per non rompere il flusso principale (BERT + Regex continueranno)
    return []
  }
}

/**
 * Elenca i modelli disponibili sul server LLM locale.
 */
export async function listLlmModels(config: LlmConfig): Promise<string[]> {
  const adapter = getAdapter(config)
  return adapter.listModels(config)
}

/**
 * Verifica che il server LLM sia raggiungibile e il modello sia disponibile.
 */
export async function testLlmConnection(
  config: LlmConfig
): Promise<LlmTestResult> {
  const adapter = getAdapter(config)
  return adapter.testConnection(config)
}
