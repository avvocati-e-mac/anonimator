import { describe, it, expect } from 'vitest'
import { sanitizeDocxHtml, hasVisiblePreview, buildHighlightHtml, buildAnonymizedHtml } from '../src/renderer/src/utils/docxPreview'
import type { DetectedEntity } from '../src/shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<DetectedEntity> & { originalText: string; pseudonym: string }): DetectedEntity {
  return {
    id: Math.random().toString(36),
    type: 'PERSONA',
    occurrences: 1,
    confirmed: true,
    ...overrides,
  }
}

// ─── sanitizeDocxHtml ─────────────────────────────────────────────────────────

describe('sanitizeDocxHtml', () => {
  it('conserva tag semantici consentiti', () => {
    const input = '<p>Testo <strong>in grassetto</strong> e <em>corsivo</em>.</p>'
    const result = sanitizeDocxHtml(input)
    expect(result).toContain('<p>')
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
    expect(result).toContain('Testo')
  })

  it('rimuove tag non nella whitelist ma preserva il testo', () => {
    const input = '<div><span>testo da preservare</span></div>'
    const result = sanitizeDocxHtml(input)
    expect(result).not.toContain('<div>')
    expect(result).not.toContain('<span>')
    expect(result).toContain('testo da preservare')
  })

  it('rimuove attributi pericolosi dai tag consentiti', () => {
    const input = '<p onclick="alert(1)" class="foo">testo</p>'
    const result = sanitizeDocxHtml(input)
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('class=')
    expect(result).toContain('<p>')
    expect(result).toContain('testo')
  })

  it('blocca href javascript: su <a>', () => {
    const input = '<a href="javascript:alert(1)">clic</a>'
    const result = sanitizeDocxHtml(input)
    expect(result).not.toContain('javascript:')
    expect(result).toContain('<a>')
    expect(result).toContain('clic')
  })

  it('conserva href valido su <a> aggiungendo rel noopener', () => {
    const input = '<a href="https://example.com">link</a>'
    const result = sanitizeDocxHtml(input)
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('rel="noopener noreferrer"')
  })

  it('conserva tag heading h2, h3', () => {
    const input = '<h2>Titolo</h2><h3>Sottotitolo</h3>'
    const result = sanitizeDocxHtml(input)
    expect(result).toContain('<h2>')
    expect(result).toContain('<h3>')
  })

  it('conserva struttura tabella', () => {
    const input = '<table><tr><td>Cella</td></tr></table>'
    const result = sanitizeDocxHtml(input)
    expect(result).toContain('<table>')
    expect(result).toContain('<tr>')
    expect(result).toContain('<td>')
    expect(result).toContain('Cella')
  })

  it('stringa vuota → stringa vuota', () => {
    expect(sanitizeDocxHtml('')).toBe('')
  })

  it('solo testo senza tag → testo invariato', () => {
    expect(sanitizeDocxHtml('testo puro')).toBe('testo puro')
  })
})

// ─── hasVisiblePreview ────────────────────────────────────────────────────────

describe('hasVisiblePreview', () => {
  it('undefined → false', () => {
    expect(hasVisiblePreview(undefined)).toBe(false)
  })

  it('stringa vuota → false', () => {
    expect(hasVisiblePreview('')).toBe(false)
  })

  it('solo whitespace → false', () => {
    expect(hasVisiblePreview('   \n  ')).toBe(false)
  })

  it('HTML con solo tag rimossi dalla sanitizzazione → false', () => {
    expect(hasVisiblePreview('<div>   </div>')).toBe(false)
  })

  it('HTML con contenuto testuale → true', () => {
    expect(hasVisiblePreview('<p>Mario Rossi</p>')).toBe(true)
  })

  it('HTML mammoth tipico → true', () => {
    expect(hasVisiblePreview('<h2>Titolo</h2><p>Corpo del testo.</p>')).toBe(true)
  })
})

// ─── buildHighlightHtml ───────────────────────────────────────────────────────

describe('buildHighlightHtml', () => {
  it('wrappa entità confermata in <mark>', () => {
    const html = '<p>Il sig. Mario Rossi è presente.</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: true })]
    const result = buildHighlightHtml(html, entities)
    expect(result).toContain('<mark')
    expect(result).toContain('Mario Rossi')
  })

  it('entità confermata ha title con pseudonimo', () => {
    const html = '<p>Mario Rossi</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: true })]
    const result = buildHighlightHtml(html, entities)
    expect(result).toContain('M. R.')
  })

  it('entità non confermata ha opacity ridotta e line-through', () => {
    const html = '<p>Mario Rossi</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: false })]
    const result = buildHighlightHtml(html, entities)
    expect(result).toContain('opacity')
    expect(result).toContain('line-through')
  })

  it('non modifica i tag HTML, solo il testo', () => {
    const html = '<p class="x">Mario Rossi</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: true })]
    const result = buildHighlightHtml(html, entities)
    // Il tag <p> deve rimanere integro (anche se class viene rimosso dalla sanitizzazione a monte)
    expect(result).toContain('<p')
    expect(result).not.toContain('<mark>Mario Rossi</mark><p')
  })

  it('nessuna entità → HTML invariato', () => {
    const html = '<p>Testo senza entità.</p>'
    expect(buildHighlightHtml(html, [])).toBe(html)
  })

  it('entità più lunga ha priorità su entità più corta sovrapposta', () => {
    const html = '<p>Giuseppe Verdi</p>'
    const entities = [
      makeEntity({ originalText: 'Giuseppe Verdi', pseudonym: 'G. V.', confirmed: true }),
      makeEntity({ originalText: 'Verdi', pseudonym: 'V.', confirmed: true, type: 'ORGANIZZAZIONE' }),
    ]
    const result = buildHighlightHtml(html, entities)
    // "Giuseppe Verdi" deve essere wrappato una sola volta, non duplicato
    expect(result).toContain('Giuseppe Verdi')
    // Non devono esserci due <mark> sovrapposti
    const markCount = (result.match(/<mark/g) ?? []).length
    expect(markCount).toBe(1)
  })
})

// ─── buildAnonymizedHtml ──────────────────────────────────────────────────────

describe('buildAnonymizedHtml', () => {
  it('sostituisce entità confermata con pseudonimo', () => {
    const html = '<p>Mario Rossi ha firmato.</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: true })]
    const result = buildAnonymizedHtml(html, entities)
    expect(result).toContain('M. R.')
    expect(result).not.toContain('Mario Rossi')
  })

  it('non sostituisce entità non confermata', () => {
    const html = '<p>Mario Rossi ha firmato.</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: false })]
    const result = buildAnonymizedHtml(html, entities)
    expect(result).toContain('Mario Rossi')
  })

  it('pseudonimo è in <span> con stile evidenziato', () => {
    const html = '<p>Mario Rossi</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: true })]
    const result = buildAnonymizedHtml(html, entities)
    expect(result).toContain('<span')
    expect(result).toContain('M. R.')
  })

  it('nessuna entità confermata → HTML invariato', () => {
    const html = '<p>Testo originale.</p>'
    const entities = [makeEntity({ originalText: 'Testo', pseudonym: 'X.', confirmed: false })]
    expect(buildAnonymizedHtml(html, entities)).toBe(html)
  })

  it('entità più lunga ha priorità su entità più corta sovrapposta', () => {
    const html = '<p>Giuseppe Verdi</p>'
    const entities = [
      makeEntity({ originalText: 'Giuseppe Verdi', pseudonym: 'G. V.', confirmed: true }),
      makeEntity({ originalText: 'Verdi', pseudonym: 'V.', confirmed: true, type: 'ORGANIZZAZIONE' }),
    ]
    const result = buildAnonymizedHtml(html, entities)
    // Solo un pseudonimo inserito
    expect(result).toContain('G. V.')
    expect(result).not.toContain('V. V.')
  })

  it('non modifica i tag HTML, solo il testo', () => {
    const html = '<p>Mario Rossi</p>'
    const entities = [makeEntity({ originalText: 'Mario Rossi', pseudonym: 'M. R.', confirmed: true })]
    const result = buildAnonymizedHtml(html, entities)
    expect(result).toContain('<p>')
    expect(result).toContain('</p>')
  })
})
