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

const SYSTEM_PROMPT = `Sei un assistente per l'anonimizzazione di documenti legali italiani. \
Il tuo compito è identificare tutti i nomi di persone fisiche e nomi di aziende/organizzazioni nel testo e restituire un array JSON di sostituzioni.

## Regole

1. **Nomi di persone**: sostituisci con le iniziali seguite da punto.
   - "Mario Rossi" → "M. R."
   - "Anna Maria Bianchi" → "A. M. B."
   - "Filippo Strozzi" → "F. S."

2. **Nomi di aziende/organizzazioni**: sostituisci il nome principale con la sua iniziale, preserva il suffisso legale.
   - "Alfa S.r.l." → "A. S.r.l."
   - "Beta S.p.A." → "B. S.p.A."
   - "Studio Legale Strozzi" → "S. L. S."

3. **NON anonimizzare**:
   - Istituzioni pubbliche (es. "Tribunale di Milano", "Corte di Cassazione")
   - Enti pubblici, organi di governo, autorità regolamentari
   - Riferimenti normativi (nomi di leggi, numeri di articoli)
   - Titoli usati da soli (es. "il Giudice", "il Presidente")
   - **CRITICO**: NON restituire MAI preposizioni, articoli o parole comuni italiane come nomi. Non sono nomi: "di", "de", "del", "della", "dello", "delle", "con", "per", "tra", "sul", "nel", "al", "detto", "detta".
   - Restituisci SOLO nomi completi (nome + cognome, o nome azienda completo). Non restituire mai particelle come "De", "Di", "Del" da sole.

4. **Formato output**: restituisci SOLO un array JSON valido. Nessuna spiegazione, nessun markdown, nessun testo aggiuntivo.
   Ogni elemento deve avere le chiavi "original" e "replacement".

Esempio:
[
  {"original": "Mario Rossi", "replacement": "M. R."},
  {"original": "Alfa S.r.l.", "replacement": "A. S.r.l."}
]

Se non trovi nomi, restituisci: []

## Importante
- Sii preciso: trova TUTTI i nomi di persone e aziende.
- Abbina il testo ESATTO come appare nel documento (maiuscole, accenti, trattini).
- Se lo stesso nome appare in forme diverse (es. "Mario Rossi" e "Rossi"), includi entrambe come voci separate con iniziali coerenti.
- Gestisci nomi italiani con particelle (es. "De Luca", "Di Marco", "Dello Russo").`

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

function isValidReplacement(original: string): boolean {
  const lower = original.trim().toLowerCase()
  if (ITALIAN_STOPWORDS.has(lower)) return false
  if (original.trim().length <= 2) return false
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

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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
