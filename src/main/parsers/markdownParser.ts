import fs from 'fs/promises'
import type { ParseResult } from './index'
import log from 'electron-log'

/**
 * Rimuove la sintassi Markdown dal testo, restituendo il testo plain visibile.
 * Usato solo per inviare testo pulito al NER — il file originale non viene toccato.
 */
function stripMarkdown(md: string): string {
  return md
    // Intestazioni: # Titolo → Titolo
    .replace(/^#{1,6}\s+/gm, '')
    // Grassetto/corsivo: **testo** / __testo__ / *testo* / _testo_
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1')
    // Codice inline: `codice`
    .replace(/`([^`]+)`/g, '$1')
    // Blocchi di codice: ```...```
    .replace(/```[\s\S]*?```/g, '')
    // Link: [testo](url) → testo
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Immagini: ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Blockquote: > testo → testo
    .replace(/^>\s?/gm, '')
    // Liste: - / * / + / 1. all'inizio riga
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Linee orizzontali: --- / *** / ___
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Righe multiple → singola riga vuota
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Estrae il testo plain da un file Markdown per l'analisi NER.
 */
export async function parseMarkdown(filePath: string): Promise<ParseResult> {
  const content = await fs.readFile(filePath, 'utf-8')
  const plainText = stripMarkdown(content)
  const pageCount = Math.max(1, Math.ceil(plainText.length / 3000))

  log.info('Markdown parsed', { chars: plainText.length, pageCount })

  return { text: plainText, pageCount, warnings: [] }
}
