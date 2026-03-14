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

export const SYSTEM_PROMPT_IT = `Restituisci l'output in formato JSON con una chiave "replacements" che contiene un array di oggetti.

Compito: estrai SOLO nomi di persone fisiche private e aziende private da testo legale italiano.

Cosa includere:
- Persone fisiche: nome + cognome (o solo cognome se chiaramente una persona). Sostituisci con iniziali puntate.
  "Mario Rossi" → "M. R.", "Dott. Anna Maria Bianchi" → "A. M. B.", "COLOMBO LUIGI" → "C. L."
  "D'ANGIOLINO AUGUSTO" → "A. D." (l'apostrofo fa parte del cognome, non spezzare)
- Aziende private: nome + suffisso legale. Sostituisci ogni parola del nome con la sua iniziale + mantieni suffisso.
  "Alfa S.r.l." → "A. S.r.l.", "ARUBAPEC S.P.A." → "A. S.P.A.", "Studio Legale Bianchi" → "S. L. B."

Cosa NON includere (non restituire nulla per questi):
- Istituzioni pubbliche: Tribunale, Corte, Ministero, Comune, Regione, Repubblica, Stato, INPS, Agenzia
- Organi giudiziari: "Corte d'Appello", "Corte di Cassazione", "SECONDA SEZIONE CIVILE", "Cass. Sez. un."
- Date, numeri, riferimenti di fascicolo: "Ud. 16/03/2023", "n. 15992/2022", "Cass. 4142/2017"
- Leggi e decreti: "D.M. 10/3/2014 n. 55", "L. 31/12/2012 n. 247", "art. 3", "C.C.", "C.P.C."
- Frasi più lunghe di 4 parole — un nome non è mai una frase
- Parole singole comuni che non sono nomi propri
- Metadati di certificati: "Firmato Da: ... Emesso Da:", "Serial#:", "Numero registro generale"
- Titoli usati da soli: "il Giudice", "Consigliere", "Rel. Consigliere"

Regola di estrazione: se un campo mescola nome e ruolo (es. "Dott. GIOVANNI FERRARI - Consigliere -"), estrai SOLO la parte nome ("GIOVANNI FERRARI").

Esempio output:
{
  "replacements": [
    {"original": "COLOMBO LUIGI", "replacement": "C. L."},
    {"original": "D'ANGIOLINO AUGUSTO", "replacement": "A. D."},
    {"original": "ARUBAPEC S.P.A.", "replacement": "A. S.P.A."},
    {"original": "Beta S.p.A.", "replacement": "B. S.p.A."}
  ]
}

Se non trovi nulla: {"replacements": []}`

export const SYSTEM_PROMPT_EN = `Return output in JSON format with a "replacements" key containing an array of objects.

Task: extract ONLY private names of natural persons and private companies from Italian legal text.

What to include:
- Natural persons: first name + last name (or last name alone if clearly a person). Replace with dotted initials.
  "Mario Rossi" → "M. R.", "Dott. Anna Maria Bianchi" → "A. M. B.", "COLOMBO LUIGI" → "C. L."
  "D'ANGIOLINO AUGUSTO" → "A. D." (the apostrophe is part of the surname — do not split it)
- Private companies: name + legal suffix. Replace each word of the name with its initial + keep suffix.
  "Alfa S.r.l." → "A. S.r.l.", "ARUBAPEC S.P.A." → "A. S.P.A.", "Studio Legale Bianchi" → "S. L. B."

What NOT to include (return nothing for these):
- Public institutions: Tribunale, Corte, Ministero, Comune, Regione, Repubblica, Stato, INPS, Agenzia
- Courts: "Corte d'Appello", "Corte di Cassazione", "SECONDA SEZIONE CIVILE", "Cass. Sez. un."
- Dates, numbers, case references: "Ud. 16/03/2023", "n. 15992/2022", "Cass. 4142/2017"
- Laws and decrees: "D.M. 10/3/2014 n. 55", "L. 31/12/2012 n. 247", "art. 3", "C.C.", "C.P.C."
- Phrases longer than 4 words — a name is never a sentence
- Single common words that are not proper names
- Certificate metadata: "Firmato Da: ... Emesso Da:", "Serial#:", "Numero registro generale"
- Job titles used alone: "il Giudice", "Consigliere", "Rel. Consigliere"

Extraction rule: if a field mixes name and role (e.g. "Dott. GIOVANNI FERRARI - Consigliere -"), extract ONLY the name part ("GIOVANNI FERRARI").

Example output:
{
  "replacements": [
    {"original": "COLOMBO LUIGI", "replacement": "C. L."},
    {"original": "D'ANGIOLINO AUGUSTO", "replacement": "A. D."},
    {"original": "ARUBAPEC S.P.A.", "replacement": "A. S.P.A."},
    {"original": "Beta S.p.A.", "replacement": "B. S.p.A."}
  ]
}

If nothing found: {"replacements": []}`

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
