import { createWorker } from 'tesseract.js'
import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { writeFile, unlink, readFile } from 'fs/promises'
import { app } from 'electron'
import type { ParseResult } from './index'
import log from 'electron-log'
import { getTessdataPath } from '../services/nerService'

const OCR_CONFIDENCE_THRESHOLD = 60

export interface OcrPageResult {
  text: string
  confidence: number
}

/**
 * Risolve i path assoluti per Tesseract.js worker e core WASM.
 *
 * In modalità packaged (app.isPackaged === true), i moduli sono in
 * `app.asar.unpacked` grazie alla config asarUnpack in electron-builder.config.js.
 * In dev, si usa `createRequire` per risolvere i path reali da node_modules.
 *
 * - workerPath: path filesystem (Node `new Worker(path)` richiede path, non URL)
 * - corePath:   file:// URL (Tesseract.js lo usa con fetch per caricare i WASM)
 */
function resolveTesseractPaths(): { workerPath: string; corePath: string } {
  const _require = createRequire(import.meta.url)
  if (app.isPackaged) {
    const base = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    return {
      workerPath: join(base, 'tesseract.js/src/worker-script/node/index.js'),
      corePath: pathToFileURL(join(base, 'tesseract.js-core')).href,
    }
  } else {
    const workerFsPath = _require.resolve('tesseract.js/src/worker-script/node/index.js')
    const coreDir = dirname(_require.resolve('tesseract.js-core/tesseract-core-simd.wasm'))
    return {
      workerPath: workerFsPath,
      corePath: pathToFileURL(coreDir).href,
    }
  }
}

async function ocrSingleImage(source: string | Buffer, pageLabel: string): Promise<OcrPageResult> {
  const tessDataDir = getTessdataPath()
  const { workerPath, corePath } = resolveTesseractPaths()

  log.info('OCR Tesseract paths', {
    isPackaged: app.isPackaged,
    workerPath,
    corePath,
    langPath: tessDataDir
  })

  const worker = await createWorker('ita', 1, {
    workerPath,
    corePath,
    langPath: pathToFileURL(tessDataDir).href,
    cacheMethod: 'none' as const,
    gzip: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        const pct = Math.round(m.progress * 100)
        if (pct % 25 === 0) {
          log.debug(`OCR ${pageLabel} progress: ${pct}%`)
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
      // Renderizza la pagina PDF in PNG tramite MuPDF (150 DPI), poi OCR
      const scale = 150 / 72
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
