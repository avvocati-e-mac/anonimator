/**
 * Testo di avanzamento dell'OCR interno.
 *
 * Vive in un modulo a sé perché la convenzione del progetto è di non testare gli
 * handler IPC direttamente ma di isolarne la logica (vedi CLAUDE.md, "IPC Testing
 * Pattern"): qui resta verificabile senza toccare `electron`.
 *
 * Nessuna di queste funzioni vede contenuto documentale: solo numeri di pagina e
 * tempi.
 */

/** Sotto questa soglia non si dà un numero di minuti: si dice "meno di un minuto". */
const SOGLIA_MINUTO_SECONDI = 45

/**
 * Coda del messaggio con il tempo residuo stimato, misurato sulle pagine già
 * concluse.
 *
 * Volutamente grossolano. Una stima al secondo ballerebbe a ogni pagina e darebbe
 * l'impressione di un conto alla rovescia che non sa quello che dice; e finché non
 * c'è almeno una pagina conclusa non si stima nulla, perché un numero inventato è
 * peggio di nessun numero.
 */
export function formatRemainingOcrTime(
  startedAt: number,
  pagesDone: number,
  totalPages: number,
  now: number = Date.now()
): string {
  const remaining = totalPages - pagesDone
  if (pagesDone <= 0 || remaining <= 0) return ''
  const perPageMs = (now - startedAt) / pagesDone
  if (!Number.isFinite(perPageMs) || perPageMs <= 0) return ''
  const seconds = Math.round((perPageMs * remaining) / 1000)
  if (seconds < SOGLIA_MINUTO_SECONDI) return ' — meno di un minuto'
  const minutes = Math.max(1, Math.round(seconds / 60))
  return ` — circa ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`
}

/** Percentuale della barra durante l'OCR: occupa la banda 30-48%. */
export function ocrProgressPercent(page: number, totalPages: number): number {
  if (totalPages <= 0) return 30
  const frazione = Math.min(1, Math.max(0, page / totalPages))
  return 30 + Math.round(frazione * 18)
}

/** Messaggio completo mostrato durante l'OCR di una pagina. */
export function buildOcrProgressMessage(
  page: number,
  totalPages: number,
  startedAt: number,
  pagesDone: number,
  now: number = Date.now()
): string {
  return (
    `Riconoscimento del testo: pagina ${page} di ${totalPages}` +
    formatRemainingOcrTime(startedAt, pagesDone, totalPages, now)
  )
}
