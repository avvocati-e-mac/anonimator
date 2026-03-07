import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import type { ParseResult } from './index'
import log from 'electron-log'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
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

/** Riga logica: token con y coordinata simile (stessa riga fisica nel PDF). */
interface LogicalLine {
  tokens: TextToken[]
  y: number
  avgFontSize: number
}

/**
 * Raggruppa i token di una pagina in righe logiche usando la coordinata Y.
 * I token con |y_a - y_b| < Y_TOLERANCE sono sulla stessa riga.
 * Ordinamento: dall'alto in basso (y decrescente in coord PDF dove y=0 è in basso).
 */
function groupTokensIntoLines(pageTokens: TextToken[]): LogicalLine[] {
  const Y_TOLERANCE = 3 // punti — token sulla stessa riga se differenza Y < 3pt

  const sorted = [...pageTokens].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: LogicalLine[] = []

  for (const token of sorted) {
    const existing = lines.find(l => Math.abs(l.y - token.y) < Y_TOLERANCE)
    if (existing) {
      existing.tokens.push(token)
      existing.avgFontSize =
        existing.tokens.reduce((s, t) => s + t.fontSize, 0) / existing.tokens.length
    } else {
      lines.push({ tokens: [token], y: token.y, avgFontSize: token.fontSize })
    }
  }

  // Ordina le righe dall'alto in basso (y decrescente)
  return lines.sort((a, b) => b.y - a.y)
}

/**
 * Costruisce il testo strutturato Markdown-like a partire dalle righe logiche di una pagina.
 *
 * - Heading # se fontSize ≥ 1.6× mediana
 * - Heading ## se fontSize ≥ 1.3× mediana
 * - Riga vuota se gap verticale > 1.5× altezza riga tipica (separatore paragrafo)
 * - normalizeSpacedLetters applicato solo alle righe non-heading
 *
 * Fallback: se si verifica un'eccezione, ritorna il testo piatto concatenato.
 */
function buildMarkdownPage(lines: LogicalLine[]): string {
  try {
    // FontSize mediano (esclude token < 5pt — probabile rumore artefatto)
    const sizes = lines
      .flatMap(l => l.tokens.map(t => t.fontSize))
      .filter(s => s >= 5)
    if (sizes.length === 0) {
      // Nessun token valido — testo piatto come fallback
      return lines.map(l => l.tokens.map(t => t.str).join('')).join('\n')
    }
    sizes.sort((a, b) => a - b)
    const medianSize = sizes[Math.floor(sizes.length / 2)]

    const result: string[] = []
    let prevY: number | null = null

    for (const line of lines) {
      const lineText = line.tokens
        .sort((a, b) => a.x - b.x)
        .map(t => t.str)
        .join('')
      const trimmed = lineText.trim()
      if (!trimmed) continue

      // Paragrafo se gap verticale > 1.5× altezza riga tipica
      if (prevY !== null) {
        const gap = prevY - line.y
        const typicalLineHeight = medianSize * 1.4
        if (gap > typicalLineHeight * 1.5) {
          result.push('')
        }
      }

      const ratio = line.avgFontSize / medianSize
      if (ratio >= 1.6) {
        result.push(`# ${trimmed}`)
      } else if (ratio >= 1.3) {
        result.push(`## ${trimmed}`)
      } else {
        result.push(normalizeSpacedLetters(trimmed))
      }

      prevY = line.y
    }

    return result.join('\n')
  } catch {
    // Fallback sicuro: testo piatto senza struttura
    return lines.map(l => l.tokens.map(t => t.str).join('')).join('\n')
  }
}

export async function parsePdf(filePath: string): Promise<PdfParseResult> {
  const warnings: string[] = []

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Usa require.resolve per trovare il worker nella directory node_modules corretta
  // (import.meta.url punta a out/main/index.js e risalirebbe nel path sbagliato)
  const workerAbsPath = path.join(
    path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
    'pdf.worker.min.mjs'
  )
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerAbsPath).toString()

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
  const allTokens: TextToken[] = []
  const pageHeights: number[] = []

  // Raccolta token per tutte le pagine (invariato — usato dall'output generator)
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    pageHeights.push(viewport.height)

    const content = await page.getTextContent()

    for (const item of content.items) {
      if (!('str' in item)) continue
      const ti = item as TextItem
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
  }

  // Costruisce testo strutturato Markdown-like per ogni pagina
  const pageTexts: string[] = pageHeights.map((_, pageIdx) => {
    const pageTokens = allTokens.filter(t => t.page === pageIdx + 1)
    if (pageTokens.length === 0) return ''
    const lines = groupTokensIntoLines(pageTokens)
    return buildMarkdownPage(lines)
  })

  const text = pageTexts
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
