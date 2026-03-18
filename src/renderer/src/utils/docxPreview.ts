/**
 * Utility per la sanitizzazione dell'HTML prodotto da mammoth prima del rendering.
 *
 * mammoth non produce script o event handler, ma è buona pratica garantire che
 * solo tag semantici noti arrivino a dangerouslySetInnerHTML — senza aggiungere
 * dipendenze esterne come DOMPurify.
 */

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
    // Conserva href su <a> solo se non è javascript:
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
 * Restituisce true se l'HTML è non vuoto e non solo whitespace,
 * dopo la sanitizzazione. Usato per decidere se mostrare il pannello anteprima.
 */
export function hasVisiblePreview(previewHtml: string | undefined): boolean {
  if (!previewHtml) return false
  const sanitized = sanitizeDocxHtml(previewHtml)
  return sanitized.trim().length > 0
}
