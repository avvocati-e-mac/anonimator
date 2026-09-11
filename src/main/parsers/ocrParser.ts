import { createWorker } from 'tesseract.js'
import { join } from 'path'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { writeFile, unlink, readFile } from 'fs/promises'
import { app } from 'electron'
import sharp from 'sharp'
import type { ParseResult } from './index'
import { privacyLog as log, safeErrorCode } from '../services/privacyLogger'
import { getTessdataPath } from '../services/nerService'
import { resolveOcrDpi, dpiToScale } from '../services/ocrRenderConfig'
import type { Matrix as MupdfMatrix } from 'mupdf'
import type { AffineMatrix } from '../services/geometry'
import {
  RenderBudgetError,
  assertPixelDimensions,
  renderWithinPixelBudget,
} from '../services/renderBudget'
import {
  ocrArtifactCache,
  type OcrArtifactWord,
  type OcrPageArtifact,
} from '../services/ocrArtifactCache'

/** Soglia di confidenza Tesseract (0-100) sotto la quale si avvisa l'utente. */
export const OCR_CONFIDENCE_THRESHOLD = 60

export class OcrProcessingError extends Error {
  constructor(readonly code: 'render-failed' | 'ocr-unavailable' | 'ocr-failed', message: string) {
    super(message)
    this.name = 'OcrProcessingError'
  }
}

/**
 * Sotto questa soglia (gradi) non si applica la contro-rotazione di deskew:
 * il costo di una pixmap con bbox allargata dalla rotazione, e del
 * ricampionamento che ne consegue, non vale la correzione per un'inclinazione
 * quasi nulla. 0,5° è già ben sotto la soglia di warning (2°) usata da
 * ocrLayerCheck.ts per giudicare una pagina "storta".
 */
const SKEW_APPLY_THRESHOLD_DEG = 0.5

export interface OcrPageResult {
  text: string
  confidence: number
  words: OcrArtifactWord[]
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is UnknownRecord => item !== null) : []
}

function artifactWord(node: UnknownRecord, page: number, line: number): OcrArtifactWord | null {
  const bbox = asRecord(node.bbox)
  const text = typeof node.text === 'string' ? node.text.trim() : ''
  if (!bbox || !text) return null
  const x0 = Number(bbox.x0)
  const y0 = Number(bbox.y0)
  const x1 = Number(bbox.x1)
  const y1 = Number(bbox.y1)
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null
  const confidence = Number(node.confidence)
  return {
    text,
    bbox: { x0, y0, x1, y1 },
    confidence: Number.isFinite(confidence) ? confidence : 0,
    line,
    page,
  }
}

/** Riduce il risultato Tesseract al solo artefatto necessario a NER/redazione/layer. */
export function extractOcrArtifactWords(data: unknown, page: number): OcrArtifactWord[] {
  const root = asRecord(data)
  if (!root) return []
  const output: OcrArtifactWord[] = []
  let lineNumber = 0
  for (const block of records(root.blocks)) {
    for (const paragraph of records(block.paragraphs)) {
      for (const line of records(paragraph.lines)) {
        lineNumber++
        for (const word of records(line.words)) {
          const reduced = artifactWord(word, page, lineNumber)
          if (reduced) output.push(reduced)
        }
      }
    }
  }
  // Compatibilità con output Tesseract configurati senza gerarchia blocks.
  if (output.length === 0) {
    lineNumber = 1
    for (const word of records(root.words)) {
      const reduced = artifactWord(word, page, lineNumber)
      if (reduced) output.push(reduced)
    }
  }
  return output
}

/**
 * Opzioni di override per il rendering e l'OCR. Tutti i campi sono opzionali:
 * senza opts il comportamento è il default storico — DPI risolto da
 * resolveOcrDpi (300 se non specificato), nessuna contro-rotazione,
 * binarizzazione lasciata al default di Tesseract (Otsu).
 */
export interface OcrParseOptions {
  /**
   * DPI desiderato dal chiamante (es. DPI nativo del raster incorporato nel
   * PDF, se noto). Risolto SEMPRE tramite resolveOcrDpi/ocrRenderConfig — MAI
   * una costante locale. Per i PDF il valore resta incorporato nella matrice
   * dell'artefatto OCR riusata da `pdfSafeGenerator.ts`; per le immagini native
   * è soltanto un hint a Tesseract, perché non avviene alcun ridimensionamento e
   * i bbox restano in pixel 1:1. Se non specificato: 300 DPI (vedi
   * OCR_RENDER_DPI_DEFAULT in ocrRenderConfig.ts e il perché nel suo commento).
   */
  dpi?: number
  /**
   * Inclinazione stimata in gradi, stessa convenzione di estimateSkew
   * (src/main/services/ocrLayerCheck.ts): positivo = righe che scendono verso
   * destra (y cresce con x). Usata solo da parsePdfWithOcr: la pagina viene
   * comunque renderizzata da MuPDF con una matrice, quindi la contro-rotazione
   * è "gratis" (nessun ricampionamento di bitmap separato). Si assume
   * costante sull'intero documento — ragionevole per un singolo passaggio di
   * scansione, non per pagine acquisite in sessioni diverse.
   */
  skewDeg?: number
  /**
   * true se l'illuminazione della scansione è nota per essere non uniforme
   * (es. foto di un documento con ombre, invece di una scansione piana).
   * Attiva la binarizzazione Sauvola al posto dell'Otsu di default di
   * Tesseract. NON attivarla per default: su scansioni pulite la
   * pre-binarizzazione toglie al motore LSTM l'informazione in scala di
   * grigi e la resa peggiora o resta indifferente — aiuta solo in presenza di
   * illuminazione non uniforme.
   */
  unevenLighting?: boolean
  /**
   * Chiamata all'inizio di ogni pagina con (pagina corrente 1-based, totale).
   * L'OCR di un documento lungo occupa minuti interi: senza questo segnale
   * l'interfaccia resta ferma su un messaggio generico per tutto il tempo, e
   * chi guarda non ha modo di distinguere "sta lavorando" da "si e' piantato".
   * Riceve solo numeri: nessun contenuto documentale attraversa questo canale.
   */
  onPageProgress?: (page: number, totalPages: number) => void
}

/**
 * DPI effettivo da usare per il rendering, dato un eventuale override del
 * chiamante. Wrapper esplicito su resolveOcrDpi (ocrRenderConfig.ts) — MAI
 * una costante locale qui — così il DPI e la matrice conservata
 * nell'artefatto OCR non possono divergere in silenzio.
 */
export function resolveRenderDpi(dpiOverride?: number): number {
  return resolveOcrDpi(dpiOverride)
}

/**
 * Costruisce la matrice di rendering (scala + eventuale contro-rotazione di
 * deskew) come tupla compatibile con mupdf.Matrix. Pura e priva di qualunque
 * dipendenza da mupdf: importare il modulo 'mupdf' istanzia il runtime WASM
 * già al solo import (vedi il caricamento dinamico più sotto in questo
 * file), quindi qui la stessa matematica è reimplementata a mano per restare
 * testabile in isolamento, senza pagare quel costo nei test.
 *
 * Equivale a mupdf.Matrix.concat(mupdf.Matrix.scale(s, s),
 * mupdf.Matrix.rotate(-skewDeg)): per una scala uniforme, scala e rotazione
 * commutano (s*I e R commutano sempre), quindi il risultato è semplicemente
 * s * R(-skewDeg). Formule verificate contro
 * node_modules/mupdf/dist/mupdf.js (Matrix.scale/rotate/concat).
 */
export function buildOcrRenderMatrix(dpi: number, skewDeg?: number): MupdfMatrix {
  const s = dpiToScale(dpi)

  if (skewDeg === undefined || !Number.isFinite(skewDeg) || Math.abs(skewDeg) < SKEW_APPLY_THRESHOLD_DEG) {
    return [s, 0, 0, s, 0, 0]
  }

  // Contro-rotazione: si ruota di -skewDeg per annullare l'inclinazione
  // misurata (convenzione estimateSkew: positivo = righe che scendono verso
  // destra, quindi la si corregge ruotando nel verso opposto).
  const rad = (-skewDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const sn = Math.sin(rad)
  return [s * c, s * sn, -s * sn, s * c, 0, 0]
}

/**
 * Le immagini standalone vengono date a Tesseract nei loro pixel originali e
 * il generatore le incapsula in una pagina PDF con 1 pixel = 1 punto. Il DPI
 * comunicato a Tesseract descrive la risoluzione, ma non è una trasformazione
 * geometrica: i bbox dell'artefatto devono quindi restare in matrice identità.
 */
export function buildImagePixelMatrix(): MupdfMatrix {
  return [1, 0, 0, 1, 0, 0]
}

/** true se la confidenza (0-100) di una pagina/immagine OCR è sotto soglia. */
export function isLowConfidence(confidence: number): boolean {
  return confidence < OCR_CONFIDENCE_THRESHOLD
}

/** Messaggio di warning per una singola immagine con OCR di bassa qualità. */
export function buildImageLowConfidenceWarning(confidence: number): string {
  return `Qualità OCR bassa (${Math.round(confidence)}%). Verificare manualmente le entità rilevate.`
}

/** Messaggio di warning aggregato per un PDF con una o più pagine di bassa qualità. */
export function buildPdfLowConfidenceWarning(lowConfidencePages: number): string {
  return (
    `${lowConfidencePages} pagina/e con qualità OCR bassa (< ${OCR_CONFIDENCE_THRESHOLD}%). ` +
    `Verificare manualmente le entità rilevate.`
  )
}

/**
 * Risolve il path assoluto del worker-script Tesseract.js.
 *
 * In modalità packaged (app.isPackaged === true), i moduli sono in
 * `app.asar.unpacked` grazie alla config asarUnpack in electron-builder.config.js.
 * In dev, si usa `createRequire` per risolvere il path reale da node_modules.
 *
 * - workerPath: filesystem path puro (Node `new Worker(path)` non accetta file:// URL)
 * - corePath non è necessario in Node: getCore usa require() diretto su tesseract.js-core
 */
function resolveWorkerPath(): string {
  const _require = createRequire(import.meta.url)
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules',
      'tesseract.js/src/worker-script/node/index.js')
  }
  return _require.resolve('tesseract.js/src/worker-script/node/index.js')
}

/**
 * Crea un worker Tesseract con il traineddata italiano caricato in memoria.
 * Il chiamante è responsabile di terminarlo (worker.terminate()) quando ha
 * finito. Su documenti multipagina va creato UNA SOLA VOLTA e riusato per
 * tutte le pagine: crearne uno per pagina ricaricherebbe ogni volta gli
 * ~16 MB di ita.traineddata a vuoto (vedi parsePdfWithOcr).
 */
async function createOcrWorker(options?: {
  unevenLighting?: boolean
  userDefinedDpi?: number
}): Promise<import('tesseract.js').Worker> {
  const tessDataDir = getTessdataPath()
  const workerPath = resolveWorkerPath()

  // In Electron, getEnvironment() restituisce 'electron' (non 'node'), quindi
  // tesseract.js tratta sempre langPath come URL e usa node-fetch (che non supporta
  // filesystem path né file:// URL). Soluzione: leggere il traineddata in memoria
  // e passarlo direttamente come { code, data } — bypassando completamente il fetch.
  const trainedDataPath = join(tessDataDir, 'ita.traineddata')
  const trainedDataBuffer = await readFile(trainedDataPath)
  const langData: import('tesseract.js').Lang = { code: 'ita', data: trainedDataBuffer as unknown }

  log.info('ocr-worker-configured', {
    isPackaged: app.isPackaged,
    bytes: trainedDataBuffer.length,
  })

  const worker = await createWorker([langData], 1, {
    workerPath,
    cacheMethod: 'none' as const,
    gzip: false,
    errorHandler: (err: unknown) => {
      log.error('ocr-worker-error', {
        stage: 'ocr',
        errorCode: safeErrorCode(err),
      })
    },
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        const pct = Math.round(m.progress * 100)
        if (pct % 25 === 0) {
          log.debug('ocr-progress', { percent: pct })
        }
      }
    }
  })

  // Informa Tesseract della risoluzione reale del raster passato: senza,
  // assume un default interno e può avvisare di una risoluzione "invalida".
  // Per parsePdfWithOcr il PNG è realmente a questo DPI (l'abbiamo renderizzato
  // noi); per parseImage è solo un'indicazione, perché un'immagine già
  // rasterizzata non può essere "ri-renderizzata" a un DPI diverso — farlo
  // sarebbe pura interpolazione (vedi OcrParseOptions.dpi).
  try {
    if (options?.userDefinedDpi !== undefined) {
      await worker.setParameters({ user_defined_dpi: String(options.userDefinedDpi) })
    }

    if (options?.unevenLighting) {
      // Sauvola (2 = Sauvola, vedi thresholding_method in tesseract.js-core@5.1.1):
      // aiuta SOLO con illuminazione non uniforme. Su scansioni pulite peggiora
      // o è indifferente — vedi OcrParseOptions.unevenLighting.
      await worker.setParameters({ thresholding_method: '2' })
    }

    return worker
  } catch (error) {
    await worker.terminate().catch(() => undefined)
    throw error
  }
}

async function ocrSingleImage(
  worker: import('tesseract.js').Worker,
  source: string | Buffer,
  page: number,
): Promise<OcrPageResult> {
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

    const result = await worker.recognize(imagePath, {}, {
      blocks: true,
      text: true,
      hocr: false,
      tsv: false,
    })
    const { text, confidence } = result.data
    log.info('ocr-page-completed', { page, confidence: Math.round(confidence) })
    return { text: text.trim(), confidence, words: extractOcrArtifactWords(result.data, page) }
  } finally {
    // Cancellazione immediata: niente contenuto documentale deve sopravvivere
    // sul disco più del tempo strettamente necessario al riconoscimento.
    if (tempCreated && imagePath) {
      await unlink(imagePath).catch((e) => {
        log.warn('ocr-temp-cleanup-failed', {
          stage: 'ocr',
          errorCode: safeErrorCode(e),
        })
      })
    }
  }
}

export async function parseImage(filePath: string, opts?: OcrParseOptions): Promise<ParseResult> {
  const warnings: string[] = []
  const dpi = resolveRenderDpi(opts?.dpi)
  log.info('ocr-image-dpi-resolved', { dpiRequested: opts?.dpi ?? null, dpi })

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(filePath).metadata()
  } catch {
    throw new OcrProcessingError('render-failed', 'Immagine non leggibile per OCR.')
  }
  if (!metadata.width || !metadata.height) {
    throw new OcrProcessingError('render-failed', 'Immagine non leggibile per OCR.')
  }
  assertPixelDimensions(metadata.width, metadata.height)

  // Immagine singola: un worker usa-e-getta va bene, non c'è riuso da fare.
  let worker: import('tesseract.js').Worker
  try {
    worker = await createOcrWorker({ unevenLighting: opts?.unevenLighting, userDefinedDpi: dpi })
  } catch {
    throw new OcrProcessingError('ocr-unavailable', 'Motore OCR non disponibile.')
  }

  let text: string
  let confidence: number
  let words: OcrArtifactWord[]
  try {
    let result: OcrPageResult
    try {
      result = await ocrSingleImage(worker, filePath, 1)
    } catch {
      throw new OcrProcessingError('ocr-failed', 'Riconoscimento OCR non riuscito.')
    }
    text = result.text
    confidence = result.confidence
    words = result.words
  } finally {
    await worker.terminate()
  }

  if (isLowConfidence(confidence)) {
    warnings.push(buildImageLowConfidenceWarning(confidence))
  }

  log.info('Image OCR completed', { chars: text.length, confidence: Math.round(confidence) })
  const ocrArtifactHandle = ocrArtifactCache.stage({
    pages: [{
      page: 1,
      words,
      renderMatrix: buildImagePixelMatrix(),
      pixmapOrigin: { x: 0, y: 0 },
    }],
  })
  return { text, pageCount: 1, warnings, ocrArtifactHandle }
}

export async function parsePdfWithOcr(filePath: string, opts?: OcrParseOptions): Promise<ParseResult> {
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
  const dpi = resolveRenderDpi(opts?.dpi)
  const matrix = buildOcrRenderMatrix(dpi, opts?.skewDeg)
  log.info('ocr-pdf-dpi-resolved', {
    dpiRequested: opts?.dpi ?? null,
    dpi,
    deskewApplied: matrix[1] !== 0 || matrix[2] !== 0,
  })

  const pageTexts: string[] = []
  let totalConfidence = 0
  let lowConfidencePages = 0
  const artifactPages: OcrPageArtifact[] = []

  const startTime = Date.now()
  const startHeapUsed = process.memoryUsage().heapUsed

  // Un solo worker per l'intero documento (vedi createOcrWorker). Ogni errore
  // OCR interrompe l'analisi: un fallback al testo digitale potrebbe restituire
  // una pagina vuota o incompleta proprio quando l'OCR era necessario.
  let sharedWorker: import('tesseract.js').Worker | null = null
  try {
    try {
      sharedWorker = await createOcrWorker({ unevenLighting: opts?.unevenLighting, userDefinedDpi: dpi })
    } catch (error) {
      log.warn('ocr-worker-creation-failed', {
        stage: 'ocr',
        errorCode: safeErrorCode(error),
      })
      throw new OcrProcessingError('ocr-unavailable', 'Motore OCR non disponibile.')
    }

    for (let i = 0; i < pageCount; i++) {
      log.info('ocr-page-started', { page: i + 1, pageCount })
      opts?.onPageProgress?.(i + 1, pageCount)
      const page = doc.loadPage(i) as import('mupdf').PDFPage

      let pageText: string
      let confidence: number
      let words: OcrArtifactWord[]
      let pixmapOrigin = { x: 0, y: 0 }

      try {
        // Una sola pagina "in volo" per volta: a 300 DPI un A4 RGB è
        // 2480×3508×3 ≈ 26 MB solo per il pixmap. Va distrutto subito dopo
        // aver estratto il PNG, prima di passare alla pagina successiva —
        // altrimenti su documenti lunghi il main process va in OOM, che in
        // Electron è un crash secco, non un errore gestibile.
        let pixmap: import('mupdf').Pixmap
        try {
          pixmap = renderWithinPixelBudget(
            page.getBounds(),
            matrix as AffineMatrix,
            () => page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false),
          )
        } catch (error) {
          if (error instanceof RenderBudgetError) throw error
          throw new OcrProcessingError('render-failed', 'Rendering pagina per OCR non riuscito.')
        }
        let pngBuffer: Buffer
        try {
          pixmapOrigin = { x: pixmap.getX(), y: pixmap.getY() }
          try {
            pngBuffer = Buffer.from(pixmap.asPNG())
          } catch {
            throw new OcrProcessingError('render-failed', 'Rendering pagina per OCR non riuscito.')
          }
        } finally {
          pixmap.destroy()
        }

        let ocrResult: OcrPageResult
        try {
          ocrResult = await ocrSingleImage(sharedWorker, pngBuffer, i + 1)
        } catch {
          throw new OcrProcessingError('ocr-failed', 'Riconoscimento OCR non riuscito.')
        }
        pageText = ocrResult.text
        confidence = ocrResult.confidence
        words = ocrResult.words
      } finally {
        page.destroy()
      }

      pageTexts.push(pageText)
      artifactPages.push({
        page: i + 1,
        words,
        renderMatrix: [...matrix] as MupdfMatrix,
        pixmapOrigin,
      })
      totalConfidence += confidence
      if (isLowConfidence(confidence)) lowConfidencePages++
    }

    const elapsedMs = Date.now() - startTime
    const heapDeltaMB = Math.round((process.memoryUsage().heapUsed - startHeapUsed) / (1024 * 1024))
    log.info('PDF OCR performance', { pageCount, dpi, elapsedMs, heapDeltaMB })

    const text = pageTexts.join('\n\n')
    const avgConfidence = pageCount > 0 ? totalConfidence / pageCount : 100

    if (lowConfidencePages > 0) {
      warnings.push(buildPdfLowConfidenceWarning(lowConfidencePages))
    }

    log.info('PDF OCR completed', {
      pageCount,
      chars: text.length,
      avgConfidence: Math.round(avgConfidence),
    })

    const ocrArtifactHandle = ocrArtifactCache.stage({ pages: artifactPages })
    return { text, pageCount, warnings, ocrArtifactHandle }
  } finally {
    if (sharedWorker) await sharedWorker.terminate().catch(() => undefined)
    doc.destroy()
  }
}
