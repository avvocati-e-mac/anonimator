import log from 'electron-log'
import type { LlmConfig } from '@shared/types'

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

// TODO [A/B-TEST]: tenere solo la versione migliore dopo valutazione (aggiunto v1.0.9)
export const SYSTEM_PROMPT_IT = `Restituisci SOLO un array JSON valido. Nessun testo aggiuntivo, nessun markdown.

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

Esempi (output corretto):
[
  {"original": "COLOMBO LUIGI", "replacement": "C. L."},
  {"original": "D'ANGIOLINO AUGUSTO", "replacement": "A. D."},
  {"original": "ARUBAPEC S.P.A.", "replacement": "A. S.P.A."},
  {"original": "Beta S.p.A.", "replacement": "B. S.p.A."}
]

Se non trovi persone o aziende private: []

Restituisci SOLO l'array JSON.`

export const SYSTEM_PROMPT_EN = `Return ONLY a valid JSON array. No extra text, no markdown wrappers.

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

Examples (correct output):
[
  {"original": "COLOMBO LUIGI", "replacement": "C. L."},
  {"original": "D'ANGIOLINO AUGUSTO", "replacement": "A. D."},
  {"original": "ARUBAPEC S.P.A.", "replacement": "A. S.P.A."},
  {"original": "Beta S.p.A.", "replacement": "B. S.p.A."}
]

If no private persons or companies found: []

Return ONLY the JSON array.`

export interface LlmDetectedName {
  original: string
  replacement: string
}

/**
 * Normalizza l'URL base assicurandosi che termini con /v1.
 * Supporta sia "http://host:port" che "http://host:port/v1"
 */
function normalizeBaseUrl(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, '')
  if (!url.endsWith('/v1')) return url + '/v1'
  return url
}

// Pattern che indicano falsi positivi tipici dei modelli piccoli
const SPURIOUS_PATTERNS = [
  /\d{2}[\/-]\d{2}[\/-]\d{2,4}/,          // date: 04-05-2023, 10/3/2014
  /\bn\.\s*\d+/i,                           // riferimenti: n. 28284, n. 247
  /\b(ric\.|sez\.|ud\.|art\.|d\.m\.|d\.lgs\.|legge\s+\d)/i, // abbreviazioni legali con contesto
  /[-–]\s*(presidente|consigliere|relatore|ricorrente|appellante|resistente|equa\s+riparazione)/i,
  /\b(20\d{2}|19\d{2})\b/,                 // anni: 2022, 2023, 1999...
]

function isValidReplacement(original: string): boolean {
  const trimmed = original.trim()
  const lower = trimmed.toLowerCase()
  if (ITALIAN_STOPWORDS.has(lower)) return false
  if (trimmed.length <= 2) return false
  // Scarta se inizia con preposizione/articolo (es. "di Appello di Salerno")
  const firstWord = lower.split(/\s+/)[0]
  if (ITALIAN_STOPWORDS.has(firstWord)) return false
  // Scarta frasi spurie con pattern numerici/legali
  for (const pat of SPURIOUS_PATTERNS) {
    if (pat.test(trimmed)) return false
  }
  // Scarta stringhe con più di 6 parole (nessun nome/azienda è così lungo)
  if (trimmed.split(/\s+/).length > 6) return false
  return true
}

function parseResponse(raw: string): LlmDetectedName[] | null {
  raw = raw.trim()
  // Rimuove eventuali code fences markdown
  raw = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '')
  // Estrae il primo array JSON trovato
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as unknown
    if (!Array.isArray(parsed)) return null
    return (parsed as Record<string, unknown>[])
      .filter(
        (r) =>
          r !== null &&
          typeof r === 'object' &&
          typeof r['original'] === 'string' &&
          typeof r['replacement'] === 'string' &&
          isValidReplacement(r['original'] as string)
      )
      .map((r) => ({ original: r['original'] as string, replacement: r['replacement'] as string }))
  } catch {
    return null
  }
}

/**
 * Chiama il server LLM locale per rilevare nomi e organizzazioni nel testo.
 * Lancia eccezione se il server non risponde o la risposta è malformata.
 */
export async function detectNamesWithLlm(
  text: string,
  config: LlmConfig
): Promise<LlmDetectedName[]> {
  const url = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`

  // customPrompt > promptLanguage > default IT
  // TODO [A/B-TEST]: rimuovere logica promptLanguage dopo ottimizzazione
  const systemPrompt = config.customPrompt?.trim()
    ? config.customPrompt.trim()
    : config.promptLanguage === 'en'
      ? SYSTEM_PROMPT_EN
      : SYSTEM_PROMPT_IT

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ]
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-needed' },
      body,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new Error(`LLM server error: ${response.status} ${response.statusText}`)
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = json.choices?.[0]?.message?.content ?? ''
  if (!content) return []

  const names = parseResponse(content)
  if (names === null) {
    log.warn('llmService: risposta LLM non parsabile', { preview: content.slice(0, 200) })
    return []
  }

  log.info('llmService: nomi rilevati', { count: names.length })
  return names
}

/**
 * Elenca i modelli disponibili sul server LLM locale.
 * Restituisce array vuoto in caso di errore.
 */
export async function listLlmModels(config: Pick<LlmConfig, 'baseUrl' | 'timeoutMs'>): Promise<string[]> {
  const url = `${normalizeBaseUrl(config.baseUrl)}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer not-needed' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!response.ok) return []
    const json = (await response.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id).filter(Boolean)
  } catch {
    clearTimeout(timer)
    return []
  }
}

/**
 * Verifica che il server LLM sia raggiungibile e il modello sia disponibile.
 */
export async function testLlmConnection(
  config: LlmConfig
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const models = await listLlmModels({ baseUrl: config.baseUrl, timeoutMs: 10000 })
    if (models.length === 0) {
      return { ok: false, message: 'Server raggiungibile ma nessun modello trovato.' }
    }
    if (config.model && !models.includes(config.model)) {
      return {
        ok: false,
        message: `Modello "${config.model}" non trovato. Modelli disponibili: ${models.join(', ')}`,
        models
      }
    }
    return { ok: true, message: `Connessione riuscita. ${models.length} modell${models.length === 1 ? 'o' : 'i'} disponibil${models.length === 1 ? 'e' : 'i'}.`, models }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Impossibile connettersi: ${msg}` }
  }
}
