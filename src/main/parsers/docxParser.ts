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
 * Genera anche `previewHtml` in parallelo tramite mammoth.convertToHtml(),
 * usato per mostrare un'anteprima formattata del documento in EntityReview.
 * Se la conversione HTML fallisce, il parsing del testo non viene interrotto:
 * previewHtml sarà undefined e l'anteprima semplicemente non apparirà.
 *
 * Il generatore di output (docxGenerator.ts) rimane invariato: usa ancora
 * adm-zip + XML diretto per la sostituzione, indipendente da questo parser.
 */
export async function parseDocx(filePath: string): Promise<ParseResult> {
  const [textSettled, htmlSettled] = await Promise.allSettled([
    mammoth.extractRawText({ path: filePath }),
    mammoth.convertToHtml({ path: filePath }, {
      styleMap: [
        "p[style-name='Heading 1'] => h2:fresh",
        "p[style-name='Heading 2'] => h3:fresh",
        "p[style-name='Heading 3'] => h4:fresh",
      ]
    })
  ])

  // Se l'estrazione testo fallisce, è un errore bloccante
  if (textSettled.status === 'rejected') {
    const msg = textSettled.reason instanceof Error ? textSettled.reason.message : String(textSettled.reason)
    throw new Error(`Il file DOCX è corrotto o protetto da password. Prova a riaprirlo e salvarlo nuovamente. (${msg})`)
  }

  const text = textSettled.value.value
  const warnings: string[] = textSettled.value.messages
    .filter((m) => m.type === 'warning')
    .map((m) => m.message)

  // Se la conversione HTML fallisce, logga un warning e prosegui senza preview
  let previewHtml: string | undefined
  if (htmlSettled.status === 'fulfilled') {
    const html = htmlSettled.value.value
    previewHtml = html.trim().length > 0 ? html : undefined
  } else {
    const msg = htmlSettled.reason instanceof Error ? htmlSettled.reason.message : String(htmlSettled.reason)
    log.warn('DOCX preview HTML generation failed, proceeding without preview', { error: msg })
  }

  const pageCount = Math.max(1, Math.ceil(text.length / 3000))

  log.info('DOCX parsed', { chars: text.length, pageCount, hasPreview: previewHtml !== undefined })

  return { text, pageCount, warnings, previewHtml }
}
