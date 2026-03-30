import type { EntityType, DetectedEntity, EntityDictionaryFile } from '@shared/types'
import log from 'electron-log'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import crypto from 'crypto'

// Prefissi leggibili per entità strutturate (regex-based)
const STRUCTURED_PREFIX: Partial<Record<EntityType, string>> = {
  CODICE_FISCALE: 'CF',
  PARTITA_IVA: 'PIVA',
  IBAN: 'IBAN',
  EMAIL: 'EMAIL',
  TELEFONO: 'TEL',
  DATA_NASCITA: 'NASC',
  INDIRIZZO: 'IND',
  NUMERO_DOCUMENTO: 'DOC',
  TARGA: 'TARGA'
}

interface SessionEntry {
  pseudonym: string
  type: EntityType
}

/**
 * Genera le iniziali da un nome/cognome o nome organizzazione.
 * "Mario Rossi" → "M. R."
 * "Studio Legale Strozzi" → "S. L. S."
 * "De Luca" → "D. L."
 * Se il testo è una singola parola con ≤ 2 caratteri, restituisce null (usa fallback numerico).
 */
function toInitials(text: string): string | null {
  // Rimuove contenuto tra parentesi, numeri iniziali, punteggiatura di disturbo
  const cleaned = text
    .replace(/\(.*?\)/g, '')
    .replace(/[0-9]/g, '')
    .trim()

  const parts = cleaned
    .split(/[\s\-_]+/)
    .map((p) => p.replace(/[^A-Za-zÀ-ÿ]/g, '').trim())
    .filter((p) => p.length > 0)

  if (parts.length === 0) return null

  const initials = parts.map((p) => p[0].toUpperCase() + '.').join(' ')
  return initials
}

/**
 * Gestisce il dizionario pseudonimi in memoria per l'intera sessione di lavoro.
 * Garantisce coerenza: la stessa stringa originale riceve sempre lo stesso pseudonimo.
 * I dati rimangono in RAM e non vengono mai scritti su disco.
 */
export class SessionManager {
  // Mappa: testo originale (lowercase) → entry pseudonimo
  private dictionary = new Map<string, SessionEntry>()
  // Contatori fallback per tipo (usati solo se le iniziali non sono generabili)
  private counters = new Map<EntityType, number>()

  /**
   * Restituisce il pseudonimo per un testo originale.
   * Se il testo è già in dizionario, riusa il pseudonimo esistente.
   * Se è nuovo, ne genera uno nuovo e lo memorizza.
   */
  getOrCreatePseudonym(originalText: string, type: EntityType): string {
    const key = originalText.trim().toLowerCase()

    const existing = this.dictionary.get(key)
    if (existing) {
      return existing.pseudonym
    }

    let pseudonym: string

    // Entità strutturate (CF, IBAN, ecc.) → codice numerico
    const structuredPrefix = STRUCTURED_PREFIX[type]
    if (structuredPrefix) {
      const count = (this.counters.get(type) ?? 0) + 1
      this.counters.set(type, count)
      pseudonym = `${structuredPrefix}_${String(count).padStart(3, '0')}`
    } else {
      // Persone e organizzazioni → iniziali, con fallback numerico se non generabili
      const initials = toInitials(originalText)
      if (initials) {
        // Controlla conflitti: se le stesse iniziali sono già usate per un testo diverso,
        // aggiunge un suffisso numerico per disambiguare
        const existing_with_same_initials = [...this.dictionary.values()].filter(
          (e) => e.pseudonym === initials || e.pseudonym.startsWith(initials + ' (')
        )
        if (existing_with_same_initials.length > 0) {
          pseudonym = `${initials} (${existing_with_same_initials.length + 1})`
        } else {
          pseudonym = initials
        }
      } else {
        // Fallback numerico
        const prefix = type === 'PERSONA' ? 'SOGGETTO' : type === 'ORGANIZZAZIONE' ? 'ENTE' : 'LUOGO'
        const count = (this.counters.get(type) ?? 0) + 1
        this.counters.set(type, count)
        pseudonym = `${prefix}_${String(count).padStart(3, '0')}`
      }
    }

    this.dictionary.set(key, { pseudonym, type })
    log.debug('Nuovo pseudonimo assegnato', { type, pseudonym })

    return pseudonym
  }

  /**
   * Registra un pseudonimo specifico fornito dall'LLM.
   * Usato quando l'LLM restituisce direttamente la sostituzione (es. "M. R.").
   * Se il testo era già noto con un pseudonimo diverso, mantiene quello esistente (coerenza).
   */
  registerLlmPseudonym(originalText: string, llmReplacement: string, type: EntityType): string {
    const key = originalText.trim().toLowerCase()
    const existing = this.dictionary.get(key)
    if (existing) return existing.pseudonym

    // Controlla conflitti di iniziali
    const conflicting = [...this.dictionary.values()].filter(
      (e) => e.pseudonym === llmReplacement || e.pseudonym.startsWith(llmReplacement + ' (')
    )
    const pseudonym =
      conflicting.length > 0 ? `${llmReplacement} (${conflicting.length + 1})` : llmReplacement

    this.dictionary.set(key, { pseudonym, type })
    log.debug('Pseudonimo LLM registrato', { type, pseudonym })
    return pseudonym
  }

  /**
   * Arricchisce un array di entità già rilevate con pseudonimi dalla sessione.
   * Entità già viste in precedenza ricevono lo stesso pseudonimo.
   */
  enrichEntities(entities: DetectedEntity[]): DetectedEntity[] {
    return entities.map((entity) => ({
      ...entity,
      pseudonym: entity.pseudonym || this.getOrCreatePseudonym(entity.originalText, entity.type)
    }))
  }

  getDictionaryStats(): { totalEntries: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {}
    for (const [type, count] of this.counters.entries()) {
      byType[type] = count
    }
    return { totalEntries: this.dictionary.size, byType }
  }

  /**
   * Serializza il dizionario su disco per ripristino futuro.
   */
  saveToDisk(filePath: string): void {
    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        dictionary: Array.from(this.dictionary.entries()),
        counters: Array.from(this.counters.entries()),
      }
      writeFileSync(filePath, JSON.stringify(data), 'utf-8')
      log.info('SessionManager: sessione salvata su disco', { entries: this.dictionary.size })
    } catch (err) {
      log.error('SessionManager: errore salvataggio sessione', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * Carica il dizionario da disco e restituisce le entità ricostruite.
   * Restituisce null se il file non esiste o è corrotto.
   */
  loadFromDisk(filePath: string): DetectedEntity[] | null {
    try {
      if (!existsSync(filePath)) return null
      const raw = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw) as {
        version: number
        dictionary: [string, { pseudonym: string; type: EntityType }][]
        counters: [EntityType, number][]
      }
      if (data.version !== 1) return null

      this.dictionary.clear()
      this.counters.clear()

      for (const [key, entry] of data.dictionary) {
        this.dictionary.set(key, entry)
      }
      for (const [type, count] of data.counters) {
        this.counters.set(type, count)
      }

      const entities: DetectedEntity[] = Array.from(this.dictionary.entries()).map(([key, entry]) => ({
        id: crypto.randomUUID(),
        type: entry.type,
        originalText: key,
        pseudonym: entry.pseudonym,
        occurrences: 1,
        confirmed: true,
      }))

      log.info('SessionManager: sessione caricata da disco', { entries: entities.length })
      return entities
    } catch (err) {
      log.error('SessionManager: errore caricamento sessione', { error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  hasSavedSession(filePath: string): boolean {
    return existsSync(filePath)
  }

  deleteSavedSession(filePath: string): void {
    try {
      unlinkSync(filePath)
      log.info('SessionManager: sessione eliminata dal disco')
    } catch (err) {
      log.error('SessionManager: errore eliminazione sessione', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * Importa entries da un file dizionario esportato.
   * Il pseudonimo importato ha priorità su quello NER.
   */
  importEntries(entries: EntityDictionaryFile['entries']): void {
    for (const entry of entries) {
      this.dictionary.set(entry.originalText.toLowerCase(), {
        pseudonym: entry.pseudonym,
        type: entry.type,
      })
    }

    // Ricalcola contatori scansionando i prefissi numerici nel dizionario
    const prefixToType: Record<string, EntityType> = {
      CF: 'CODICE_FISCALE',
      PIVA: 'PARTITA_IVA',
      IBAN: 'IBAN',
      EMAIL: 'EMAIL',
      TEL: 'TELEFONO',
      NASC: 'DATA_NASCITA',
      IND: 'INDIRIZZO',
      DOC: 'NUMERO_DOCUMENTO',
      TARGA: 'TARGA',
      SOGGETTO: 'PERSONA',
      ENTE: 'ORGANIZZAZIONE',
      LUOGO: 'LUOGO',
    }
    const maxCounters = new Map<EntityType, number>()
    for (const entry of this.dictionary.values()) {
      const match = /^([A-Z]+)_(\d{3})$/.exec(entry.pseudonym)
      if (match) {
        const prefix = match[1]
        const num = parseInt(match[2], 10)
        const type = prefixToType[prefix]
        if (type) {
          const current = maxCounters.get(type) ?? 0
          if (num > current) maxCounters.set(type, num)
        }
      }
    }
    for (const [type, max] of maxCounters.entries()) {
      const current = this.counters.get(type) ?? 0
      if (max > current) this.counters.set(type, max)
    }

    log.info('SessionManager: entries importate', { count: entries.length })
  }

  reset(): void {
    this.dictionary.clear()
    this.counters.clear()
    log.info('SessionManager: dizionario resettato')
  }
}

// Singleton: una sola istanza per tutta la vita del processo Main
export const sessionManager = new SessionManager()
