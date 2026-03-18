import mammoth from 'mammoth'
import log from 'electron-log'
import type { ParseResult } from './index'

/**
 * Estrae il testo da un file .docx usando mammoth.
 *
 * mammoth gestisce nativamente il run-split (testo spezzato su più <w:t>),
 * tabelle complesse, content controls e hyperlink — casi fragili nel parser
 * XML manuale precedente.
 *
 * Il generatore di output (docxGenerator.ts) rimane invariato: usa ancora
 * adm-zip + XML diretto per la sostituzione, che è indipendente da questo parser.
 */
export async function parseDocx(filePath: string): Promise<ParseResult> {
  let textResult: Awaited<ReturnType<typeof mammoth.extractRawText>>

  try {
    textResult = await mammoth.extractRawText({ path: filePath })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Il file DOCX è corrotto o protetto da password. Prova a riaprirlo e salvarlo nuovamente. (${msg})`)
  }

  const text = textResult.value
  const warnings: string[] = textResult.messages
    .filter((m) => m.type === 'warning')
    .map((m) => m.message)

  const pageCount = Math.max(1, Math.ceil(text.length / 3000))

  log.info('DOCX parsed', { chars: text.length, pageCount })

  return { text, pageCount, warnings }
}
