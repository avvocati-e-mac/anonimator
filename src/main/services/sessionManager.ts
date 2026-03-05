import type { EntityType, DetectedEntity } from '@shared/types'
import log from 'electron-log'

// Prefissi leggibili per ogni tipo di entità nel documento anonimizzato
const ENTITY_PREFIX: Record<EntityType, string> = {
  PERSONA: 'SOGGETTO',
  ORGANIZZAZIONE: 'ENTE',
  LUOGO: 'LUOGO',
  CODICE_FISCALE: 'CF',
  PARTITA_IVA: 'PIVA',
  IBAN: 'IBAN',
  EMAIL: 'EMAIL',
  TELEFONO: 'TEL'
}

interface SessionEntry {
  pseudonym: string
  type: EntityType
}

/**
 * Gestisce il dizionario pseudonimi in memoria per l'intera sessione di lavoro.
 * Garantisce coerenza: la stessa stringa originale riceve sempre lo stesso pseudonimo.
 * I dati rimangono in RAM e non vengono mai scritti su disco.
 */
export class SessionManager {
  // Mappa: testo originale (lowercase) → entry pseudonimo
  private dictionary = new Map<string, SessionEntry>()
  // Contatori per tipo: quanti pseudonimi di quel tipo sono stati assegnati
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

    // Nuovo: incrementa il contatore per questo tipo e crea pseudonimo
    const count = (this.counters.get(type) ?? 0) + 1
    this.counters.set(type, count)
    const pseudonym = `${ENTITY_PREFIX[type]}_${String(count).padStart(3, '0')}`

    this.dictionary.set(key, { pseudonym, type })
    log.debug('Nuovo pseudonimo assegnato', { type, pseudonym })

    return pseudonym
  }

  /**
   * Arricchisce un array di entità già rilevate con pseudonimi dalla sessione.
   * Entità già viste in precedenza ricevono lo stesso pseudonimo.
   */
  enrichEntities(entities: DetectedEntity[]): DetectedEntity[] {
    return entities.map((entity) => ({
      ...entity,
      pseudonym: this.getOrCreatePseudonym(entity.originalText, entity.type)
    }))
  }

  /**
   * Restituisce una copia dell'intero dizionario (per debug/log — senza contenuto dei testi).
   */
  getDictionaryStats(): { totalEntries: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {}
    for (const [type, count] of this.counters.entries()) {
      byType[type] = count
    }
    return { totalEntries: this.dictionary.size, byType }
  }

  /**
   * Svuota il dizionario (chiamato quando l'utente vuole iniziare una nuova sessione).
   */
  reset(): void {
    this.dictionary.clear()
    this.counters.clear()
    log.info('SessionManager: dizionario resettato')
  }
}

// Singleton: una sola istanza per tutta la vita del processo Main
export const sessionManager = new SessionManager()
