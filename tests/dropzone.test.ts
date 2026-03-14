import { describe, it, expect } from 'vitest'
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME } from '../src/renderer/src/components/DropZone'

function isExtensionAccepted(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return ACCEPTED_EXTENSIONS.includes(ext)
}

function isMimeAccepted(mime: string): boolean {
  return mime in ACCEPTED_MIME
}

describe('DropZone — formato accettato', () => {
  it('.md è accettato nelle estensioni', () => {
    expect(isExtensionAccepted('documento.md')).toBe(true)
  })

  it('.MD maiuscolo è accettato (case-insensitive)', () => {
    expect(isExtensionAccepted('documento.MD')).toBe(true)
  })

  it('text/markdown è accettato nei MIME type', () => {
    expect(isMimeAccepted('text/markdown')).toBe(true)
  })

  it('text/x-markdown è accettato nei MIME type', () => {
    expect(isMimeAccepted('text/x-markdown')).toBe(true)
  })

  // Regression: formati preesistenti
  it('.pdf è accettato', () => {
    expect(isExtensionAccepted('contratto.pdf')).toBe(true)
  })

  it('.docx è accettato', () => {
    expect(isExtensionAccepted('atto.docx')).toBe(true)
  })

  it('.odt è accettato', () => {
    expect(isExtensionAccepted('sentenza.odt')).toBe(true)
  })

  it('.txt è accettato', () => {
    expect(isExtensionAccepted('note.txt')).toBe(true)
  })

  it('.png è accettato', () => {
    expect(isExtensionAccepted('scansione.png')).toBe(true)
  })

  it('.jpg è accettato', () => {
    expect(isExtensionAccepted('foto.jpg')).toBe(true)
  })

  // Formato non supportato
  it('.xyz NON è accettato', () => {
    expect(isExtensionAccepted('file.xyz')).toBe(false)
  })

  it('.exe NON è accettato', () => {
    expect(isExtensionAccepted('virus.exe')).toBe(false)
  })
})
