import { describe, expect, it } from 'vitest'
import { anonymizationProgressMessage } from '../src/main/services/ocrProgressMessage'

describe('messaggi avanzamento anonimizzazione', () => {
  it('spiega che il testo OCR esistente viene riutilizzato', () => {
    const message = anonymizationProgressMessage('prepare')
    expect(message).toContain('riuso del testo OCR già in memoria')
    expect(message).not.toContain('Riconoscimento del testo')
  })

  it('distingue la ricostruzione del documento dalla fase OCR', () => {
    const message = anonymizationProgressMessage('redact')
    expect(message).toContain('rimozione dei dati')
    expect(message).toContain('ricostruzione del documento')
    expect(message).not.toContain('Riconoscimento del testo')
  })
})
