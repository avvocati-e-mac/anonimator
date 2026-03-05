import { createWorker } from 'tesseract.js'
import { join } from 'path'
import { app } from 'electron'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { writeFile, unlink } from 'fs/promises'
import type { PDFDocumentProxy, TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
import type { ParseResult } from './index'
import log from 'electron-log'

const OCR_CONFIDENCE_THRESHOLD = 60

export interface OcrPageResult {
  text: string
  confidence: number
}

async function ocrSingleImage(source: string | Buffer, pageLabel: string): Promise<OcrPageResult> {
  const tessDataDir = join(app.getAppPath(), 'resources', 'tessdata')

  const worker = await createWorker('ita', 1, {
    langPath: tessDataDir,
    cachePath: tessDataDir,
    cacheMethod: 'none' as const,
    logger: () => {}
  })

  let imagePath: string | null = null
  let tempCreated = false

  try {
    if (Buffer.isBuffer(source)) {
      imagePath = join(tmpdir(), `ocr_${randomBytes(8).toString('hex')}.png`)
      await writeFile(imagePath, source)
      tempCreated = true
    } else {
      imagePath = source
    }

    const result = await worker.recognize(imagePath)
    const { text, confidence } = result.data
    log.info(`OCR ${pageLabel}`, { confidence: Math.round(confidence) })
    return { text: text.trim(), confidence }
  } finally {
    await worker.terminate()
    if (tempCreated && imagePath) {
      await unlink(imagePath).catch((e) => {
        log.warn('OCR: impossibile eliminare temp file', { path: imagePath, error: String(e) })
      })
    }
  }
}

export async function parseImage(filePath: string): Promise<ParseResult> {
  const warnings: string[] = []
  const { text, confidence } = await ocrSingleImage(filePath, 'immagine')

  if (confidence < OCR_CONFIDENCE_THRESHOLD) {
    warnings.push(
      `Qualità OCR bassa (${Math.round(confidence)}%). Verificare manualmente le entità rilevate.`
    )
  }

  log.info('Image OCR completed', { chars: text.length, confidence: Math.round(confidence) })
  return { text, pageCount: 1, warnings }
}

export async function parsePdfWithOcr(filePath: string): Promise<ParseResult> {
  const warnings: string[] = []
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerPath = new URL(
    '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url
  ).href
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath

  let doc: PDFDocumentProxy
  try {
    const task = pdfjs.getDocument({ url: filePath, isEvalSupported: false, useSystemFonts: true })
    doc = await task.promise
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('password')) {
      throw new Error('Il PDF è protetto da password. Rimuovi la protezione prima di procedere.')
    }
    throw new Error(`Impossibile aprire il PDF per OCR: ${msg}`)
  }

  const pageCount = doc.numPages
  const pageTexts: string[] = []
  let totalConfidence = 0
  let lowConfidencePages = 0

  for (let i = 1; i <= pageCount; i++) {
    log.info(`OCR pagina ${i}/${pageCount}`)
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 150 / 72 }) // 150 DPI

    let pageText = ''
    let confidence = 100

    try {
      // Renderizza la pagina PDF in PNG tramite node-canvas, poi OCR
      const canvasFactory = createNodeCanvasFactory()
      const cc = canvasFactory.create(viewport.width, viewport.height)

      // cast necessario: node-canvas implementa CanvasRenderingContext2D ma non estende il tipo DOM
      // canvasFactory non è nei RenderParameters dichiarati ma è supportato a runtime da pdfjs
      const renderParams = { canvasContext: cc.context as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]
      await page.render(renderParams).promise

      const pngBuffer = cc.canvas.toBuffer('image/png')
      const ocrResult = await ocrSingleImage(pngBuffer, `pagina ${i}`)
      pageText = ocrResult.text
      confidence = ocrResult.confidence
    } catch {
      // Fallback: estrai il testo digitale se disponibile (es. PDF ibridi)
      log.warn(`OCR rendering non disponibile per pagina ${i}, uso testo digitale`)
      const content = await page.getTextContent()
      pageText = content.items
        .map((item: TextItem | TextMarkedContent) => ('str' in item ? item.str : ''))
        .join(' ')
      confidence = 100
    }

    pageTexts.push(pageText)
    totalConfidence += confidence
    if (confidence < OCR_CONFIDENCE_THRESHOLD) lowConfidencePages++
  }

  const text = pageTexts.join('\n\n')
  const avgConfidence = pageCount > 0 ? totalConfidence / pageCount : 100

  if (lowConfidencePages > 0) {
    warnings.push(
      `${lowConfidencePages} pagina/e con qualità OCR bassa (< ${OCR_CONFIDENCE_THRESHOLD}%). ` +
      `Verificare manualmente le entità rilevate.`
    )
  }

  log.info('PDF OCR completed', {
    pageCount,
    chars: text.length,
    avgConfidence: Math.round(avgConfidence)
  })

  return { text, pageCount, warnings }
}

// ─── Canvas factory per pdfjs in Node.js ─────────────────────────────────────

interface CanvasLike {
  toBuffer: (format: string) => Buffer
  width: number
  height: number
}

interface CanvasAndContext {
  canvas: CanvasLike
  context: unknown
}

interface NodeCanvasFactory {
  create: (width: number, height: number) => CanvasAndContext
  reset: (cc: CanvasAndContext, width: number, height: number) => void
  destroy: (cc: CanvasAndContext) => void
  [key: string]: unknown
}

function createNodeCanvasFactory(): NodeCanvasFactory {
  // node-canvas non è una dipendenza diretta; se non installato, il try/catch
  // nel chiamante gestisce il fallback all'estrazione testo digitale
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => CanvasLike & { getContext: (t: string) => unknown } }

  return {
    create(width: number, height: number): CanvasAndContext {
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      return { canvas, context }
    },
    reset(cc: CanvasAndContext, width: number, height: number): void {
      cc.canvas.width = width
      cc.canvas.height = height
    },
    destroy(_cc: CanvasAndContext): void {}
  }
}
