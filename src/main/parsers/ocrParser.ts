import { createWorker } from 'tesseract.js'
import { resolve, join, dirname } from 'path'
import { pathToFileURL } from 'url'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { writeFile, unlink, readFile } from 'fs/promises'
import { app } from 'electron'
import type { ParseResult } from './index'
import log from 'electron-log'
import { getTessdataPath } from '../services/nerService'

const _require = createRequire(import.meta.url)
const OCR_CONFIDENCE_THRESHOLD = 60

export interface OcrPageResult {
  text: string
  confidence: number
}

async function ocrSingleImage(source: string | Buffer, pageLabel: string): Promise<OcrPageResult> {
  const tessDataDir = getTessdataPath()

  // Risoluzione path assoluti per Tesseract.js in ambiente Node/Electron
  // langPath richiede file:// URL per node-fetch interno
  const tessDataUrl = pathToFileURL(tessDataDir).href
  
  // workerPath DEVE essere un path filesystem perché usato da new Worker() di Node
  const workerPath = _require.resolve('tesseract.js/src/worker-script/node/index.js')
  
  // corePath DEVE essere file:// URL perché Tesseract.js lo usa con fetch
  const coreDir = dirname(_require.resolve('tesseract.js-core/tesseract-core-simd.wasm'))
  const corePath = pathToFileURL(coreDir).href

  log.info('OCR Tesseract paths', {
    tessDataUrl,
    workerPath,
    corePath,
    isPackaged: app.isPackaged
  })

  const worker = await createWorker('ita', 1, {
    workerPath,
    corePath,
    langPath: tessDataUrl,
    cachePath: tessDataDir,
    cacheMethod: 'none' as const,
    gzip: false,
    logger: (m) => {
      if (m.status === 'recognizing text') {
        if (Math.round(m.progress * 100) % 25 === 0) {
          log.debug(`OCR ${pageLabel} progress: ${Math.round(m.progress * 100)}%`)
        }
      } else {
        log.debug(`OCR ${pageLabel} status: ${m.status}`)
      }
    }
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
  const mupdf = (await import('mupdf')).default as typeof import('mupdf')

  const fileBuffer = await readFile(filePath)
  let doc: import('mupdf').PDFDocument
  try {
    doc = new mupdf.PDFDocument(fileBuffer as unknown as ArrayBuffer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('password')) {
      throw new Error('Il PDF è protetto da password. Rimuovi la protezione prima di procedere.')
    }
    throw new Error(`Impossibile aprire il PDF per OCR: ${msg}`)
  }

  const pageCount = doc.countPages()
  const pageTexts: string[] = []
  let totalConfidence = 0
  let lowConfidencePages = 0
  let digitalFallbackPages = 0

  for (let i = 0; i < pageCount; i++) {
    log.info(`OCR pagina ${i + 1}/${pageCount}`)
    const page = doc.loadPage(i) as import('mupdf').PDFPage

    let pageText = ''
    let confidence = 100

    try {
      // Renderizza la pagina PDF in PNG tramite MuPDF, poi OCR
      const scale = 150 / 72 // 150 DPI
      const matrix = mupdf.Matrix.scale(scale, scale)
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false)
      const pngBuffer = Buffer.from(pixmap.asPNG())

      const ocrResult = await ocrSingleImage(pngBuffer, `pagina ${i + 1}`)
      pageText = ocrResult.text
      confidence = ocrResult.confidence
    } catch (err) {
      // Fallback: estrai il testo digitale se disponibile (es. PDF ibridi)
      digitalFallbackPages++
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.warn(`OCR rendering fallito per pagina ${i + 1}, uso testo digitale`, { error: errorMsg })
      
      const stext = page.toStructuredText()
      pageText = stext.asText()
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
    avgConfidence: Math.round(avgConfidence),
    digitalFallbackPages
  })

  return { text, pageCount, warnings }
}
