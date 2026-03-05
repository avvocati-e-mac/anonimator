import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import type { ParseResult } from './index'
import log from 'electron-log'
import { createRequire } from 'module'
import path from 'path'
import fs from 'fs/promises'

const require = createRequire(import.meta.url)

const MIN_CHARS_PER_PAGE = 80

/**
 * Normalizza il testo estratto da PDF con font a spaziatura anomala.
 * Alcuni PDF producono testo tipo "L A C O R T E S U P R E M A" invece di "LA CORTE SUPREMA".
 * Il pattern: sequenza di lettere singole (maiuscole o minuscole) separate da spazio singolo,
 * lunga almeno 3 token → viene compressa rimuovendo gli spazi interni.
 *
 * Esempi:
 *   "L A C O R T E"        → "LACORTE"   (poi il NER capisce il contesto)
 *   "C A S S A Z I O N E"  → "CASSAZIONE"
 *   "parola normale"        → invariata (non tocca parole di 2+ caratteri)
 */
function normalizeSpacedLetters(text: string): string {
  // Sostituisce sequenze di 3+ singole lettere separate da spazio con la parola compressa.
  // \b[A-Za-zÀ-ÿ]\b corrisponde a una singola lettera (anche accentata).
  return text.replace(
    /(?<![A-Za-zÀ-ÿ])([A-Za-zÀ-ÿ](?: [A-Za-zÀ-ÿ]){2,})(?![A-Za-zÀ-ÿ])/g,
    (match) => match.replace(/ /g, '')
  )
}

export interface TextToken {
  str: string
  page: number       // 1-based
  x: number          // coordinate in punti PDF (origine in basso a sinistra)
  y: number
  width: number
  height: number
  fontSize: number
}

export interface PdfParseResult extends ParseResult {
  isScanned: boolean
  tokens: TextToken[]   // tutti i token con coordinate (per il generatore)
  pageHeights: number[] // altezza di ogni pagina in punti (per convertire le coordinate)
}

export async function parsePdf(filePath: string): Promise<PdfParseResult> {
  const warnings: string[] = []

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Usa require.resolve per trovare il worker nella directory node_modules corretta
  // (import.meta.url punta a out/main/index.js e risalirebbe nel path sbagliato)
  const workerPath = path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')) +
    '/pdf.worker.min.mjs'
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath

  // Legge il file come buffer per evitare problemi di encoding nell'URL
  const fileBuffer = await fs.readFile(filePath)
  const data = new Uint8Array(fileBuffer)

  let doc: PDFDocumentProxy
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      disableAutoFetch: true
    })
    doc = await loadingTask.promise
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('password')) {
      throw new Error('Il PDF è protetto da password. Rimuovi la protezione prima di procedere.')
    }
    throw new Error(`Impossibile aprire il PDF: ${msg}`)
  }

  const pageCount = doc.numPages
  const pageTexts: string[] = []
  const allTokens: TextToken[] = []
  const pageHeights: number[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const pageHeight = viewport.height
    pageHeights.push(pageHeight)

    const content = await page.getTextContent()

    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      const ti = item as TextItem
      pageText += ti.hasEOL ? ti.str + '\n' : ti.str

      if (ti.str.trim() === '') continue

      // La transform matrix di pdfjs: [scaleX, skewY, skewX, scaleY, x, y]
      // y è già in coordinate PDF (origine in basso a sinistra)
      const [, , , scaleY, x, y] = ti.transform as number[]
      const itemHeight = Math.abs(scaleY)
      const itemWidth = ti.width ?? 0

      allTokens.push({
        str: ti.str,
        page: i,
        x,
        y,
        width: itemWidth,
        height: itemHeight,
        fontSize: itemHeight
      })
    }

    pageTexts.push(pageText)
  }

  const text = pageTexts
    .map(normalizeSpacedLetters)
    .join('\n\n')
    .replace(/\r\n/g, '\n')
  const avgCharsPerPage = pageCount > 0 ? text.length / pageCount : 0
  const isScanned = avgCharsPerPage < MIN_CHARS_PER_PAGE

  if (isScanned) {
    warnings.push(
      `Il PDF sembra una scansione (${Math.round(avgCharsPerPage)} caratteri/pagina). ` +
      `Verrà applicato il riconoscimento ottico del testo (OCR).`
    )
  }

  log.info('PDF parsed', {
    pageCount,
    chars: text.length,
    avgCharsPerPage: Math.round(avgCharsPerPage),
    isScanned
  })

  return { text, pageCount, warnings, isScanned, tokens: allTokens, pageHeights }
}
