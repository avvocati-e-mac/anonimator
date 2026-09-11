import { readFile } from 'fs/promises'
import type { ParseResult } from './index'
import { privacyLog as log } from '../services/privacyLogger'

/**
 * Estrae il testo da un file .txt.
 * Prova UTF-8; se fallisce riprova con latin1 (comune in documenti italiani vecchi).
 */
export async function parseTxt(filePath: string): Promise<ParseResult> {
  let text: string

  try {
    text = await readFile(filePath, 'utf-8')
  } catch {
    log.warn('txt-utf8-read-failed-latin1-fallback', { stage: 'parser' })
    const buf = await readFile(filePath)
    text = buf.toString('latin1')
  }

  // Normalizza a capo: \r\n → \n
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Stima pagine: ~3000 caratteri per pagina A4 con testo normale
  const pageCount = Math.max(1, Math.ceil(text.length / 3000))

  log.info('TXT parsed', { chars: text.length, pageCount })

  return { text, pageCount, warnings: [] }
}
