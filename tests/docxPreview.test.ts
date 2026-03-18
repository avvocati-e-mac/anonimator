import { describe, it, expect } from 'vitest'
import { sanitizeDocxHtml, hasVisiblePreview } from '../src/renderer/src/utils/docxPreview'

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
    // <div> viene rimosso, rimane solo whitespace
    expect(hasVisiblePreview('<div>   </div>')).toBe(false)
  })

  it('HTML con contenuto testuale → true', () => {
    expect(hasVisiblePreview('<p>Mario Rossi</p>')).toBe(true)
  })

  it('HTML mammoth tipico → true', () => {
    expect(hasVisiblePreview('<h2>Titolo</h2><p>Corpo del testo.</p>')).toBe(true)
  })
})
