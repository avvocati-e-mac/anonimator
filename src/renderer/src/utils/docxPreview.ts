/**
 * Utility per la sanitizzazione e il rendering dell'HTML prodotto da mammoth.
 *
 * Offre tre modalità di visualizzazione per il pannello anteprima DOCX:
 * - 'original':    documento originale con entità evidenziate (highlight colorato)
 * - 'anonymized':  documento con pseudonimi al posto delle entità confermate
 *
 * Tutte le funzioni operano solo sull'HTML sanitizzato — mai sul testo estratto
 * dai documenti reali. Nessun contenuto documentale viene loggato.
 */

import type { DetectedEntity } from '@shared/types'
import { ENTITY_CONFIG } from './entityConfig'

export type PreviewMode = 'original' | 'anonymized'

// ─── Whitelist tag HTML ───────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'u', 's', 'br',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'blockquote', 'a',
])

/**
 * Sanitizza l'HTML prodotto da mammoth: rimuove tag non semantici e attributi
 * potenzialmente pericolosi, preserva il contenuto testuale.
 */
export function sanitizeDocxHtml(html: string): string {
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tag: string) => {
    const lower = tag.toLowerCase()
    if (!ALLOWED_TAGS.has(lower)) return ''
    if (lower === 'a') {
      const hrefMatch = /href="([^"]*)"/.exec(match)
      if (hrefMatch && !hrefMatch[1].trim().toLowerCase().startsWith('javascript')) {
        return `<a href="${hrefMatch[1]}" rel="noopener noreferrer">`
      }
      return '<a>'
    }
    if (match.startsWith('</')) return `</${lower}>`
    return `<${lower}>`
  })
}

/**
 * Restituisce true se l'HTML è non vuoto dopo sanitizzazione.
 */
export function hasVisiblePreview(previewHtml: string | undefined): boolean {
  if (!previewHtml) return false
  const sanitized = sanitizeDocxHtml(previewHtml)
  return sanitized.trim().length > 0
}

// ─── Helpers per il replace nel testo HTML ───────────────────────────────────

/**
 * Applica una funzione di sostituzione solo al testo dei nodi HTML,
 * senza toccare i tag. Lavora sulle sequenze di testo tra i tag.
 *
 * Strategia: splitta l'HTML in segmenti (testo | tag), trasforma solo
 * i segmenti di testo, riassembla.
 */
function replaceInHtmlText(
  html: string,
  replacer: (text: string) => string
): string {
  // Splitta preservando i tag come delimitatori
  const parts = html.split(/(<[^>]+>)/g)
  return parts
    .map((part) => {
      // Se è un tag (inizia con <), lascialo invariato
      if (part.startsWith('<')) return part
      // Altrimenti è testo: applica la sostituzione
      return replacer(part)
    })
    .join('')
}

/**
 * Normalizza quote tipografiche → ASCII (stesso helper del generator).
 */
function normalizeQuotes(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
}

// ─── Modalità ORIGINAL: highlight entità ─────────────────────────────────────

/**
 * Restituisce il colore Tailwind bg per il tipo di entità (usato inline
 * negli attributi style= per i <mark> — necessario perché le classi
 * dinamiche non vengono purgate da Tailwind in produzione).
 */
function entityBgColor(type: DetectedEntity['type']): string {
  const colorMap: Record<string, string> = {
    PERSONA:          '#bfdbfe', // blue-200
    ORGANIZZAZIONE:   '#d9f99d', // lime-200
    LUOGO:            '#fde68a', // amber-200
    CODICE_FISCALE:   '#fca5a5', // red-300
    PARTITA_IVA:      '#f9a8d4', // pink-300
    IBAN:             '#6ee7b7', // emerald-300
    EMAIL:            '#c4b5fd', // violet-300
    TELEFONO:         '#67e8f9', // cyan-300
    DATA_NASCITA:     '#fcd34d', // amber-300
    INDIRIZZO:        '#fdba74', // orange-300
    NUMERO_DOCUMENTO: '#a5b4fc', // indigo-300
  }
  return colorMap[type] ?? '#e2e8f0'
}

/**
 * Genera l'HTML con le entità evidenziate con <mark>.
 * - Entità confermate: colore pieno, tooltip con pseudonimo
 * - Entità non confermate: colore sbiadito + testo barrato
 * Le entità più lunghe hanno priorità (evita sostituzioni parziali).
 */
export function buildHighlightHtml(
  sanitizedHtml: string,
  entities: DetectedEntity[]
): string {
  if (entities.length === 0) return sanitizedHtml

  // Ordina per lunghezza decrescente per prioritizzare match più lunghi
  const sorted = [...entities].sort(
    (a, b) => b.originalText.length - a.originalText.length
  )

  // Placeholder univoci per evitare che un'entità venga matchata due volte
  // dopo che un'altra è già stata sostituita
  const placeholders: Array<{ placeholder: string; html: string }> = []

  let result = sanitizedHtml

  for (const entity of sorted) {
    const normalized = normalizeQuotes(entity.originalText)
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const bg = entityBgColor(entity.type)
    const label = ENTITY_CONFIG[entity.type]?.label ?? entity.type
    const placeholder = `\x00ENTITY_${placeholders.length}\x00`

    const markHtml = entity.confirmed
      ? `<mark style="background:${bg};border-radius:3px;padding:0 2px;" title="${label}: ${entity.pseudonym}">${entity.originalText}</mark>`
      : `<mark style="background:${bg};opacity:0.35;border-radius:3px;padding:0 2px;text-decoration:line-through;" title="${label} (esclusa)">${entity.originalText}</mark>`

    const replaced = replaceInHtmlText(result, (text) => {
      const normalizedText = normalizeQuotes(text)
      return normalizedText.replace(regex, () => placeholder)
    })

    if (replaced !== result) {
      placeholders.push({ placeholder, html: markHtml })
      result = replaced
    }
  }

  // Sostituisce i placeholder con il markup finale
  for (const { placeholder, html } of placeholders) {
    result = result.split(placeholder).join(html)
  }

  return result
}

// ─── Modalità ANONYMIZED: pseudonimi nel testo ────────────────────────────────

/**
 * Genera l'HTML con le entità confermate sostituite dai loro pseudonimi.
 * Le entità non confermate rimangono invariate.
 */
export function buildAnonymizedHtml(
  sanitizedHtml: string,
  entities: DetectedEntity[]
): string {
  const confirmed = [...entities]
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  if (confirmed.length === 0) return sanitizedHtml

  const placeholders: Array<{ placeholder: string; replacement: string }> = []
  let result = sanitizedHtml

  for (const entity of confirmed) {
    const normalized = normalizeQuotes(entity.originalText)
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const placeholder = `\x00ANON_${placeholders.length}\x00`
    const pseudonymHtml = `<span style="background:#dbeafe;border-radius:3px;padding:0 2px;font-style:italic;" title="Pseudonimo di: ${entity.type}">${entity.pseudonym}</span>`

    const replaced = replaceInHtmlText(result, (text) => {
      const normalizedText = normalizeQuotes(text)
      return normalizedText.replace(regex, () => placeholder)
    })

    if (replaced !== result) {
      placeholders.push({ placeholder, replacement: pseudonymHtml })
      result = replaced
    }
  }

  for (const { placeholder, replacement } of placeholders) {
    result = result.split(placeholder).join(replacement)
  }

  return result
}
