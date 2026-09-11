import fs from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import { join } from 'path'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import { app } from 'electron'
import log from 'electron-log'
import type { DetectedEntity, EntityRedactionOutcome, PartialReason, SaveResult } from '@shared/types'
import type { PdfPageQualityOutcome } from '../services/ocrLayerCheck'
import { getTessdataPath } from '../services/nerService'
import { PDF_POINTS_PER_INCH } from '../services/ocrRenderConfig'
import { matchEntitiesOnPage, type MatchWord } from '../services/entityMatcher'
import { mupdfRectToPdfUserSpace, renderedPixelRectToMupdf, transformRect, type AffineMatrix, type Rect } from '../services/geometry'

export const MAX_PAGE_PIXELS = 50_000_000
export const RASTER_JPEG_QUALITY = 85
export const MIXED_DIGITAL_DPI = 300
const MAX_RECT_RATIO = 0.25

type Mupdf = Awaited<ReturnType<typeof loadMupdf>>
type Worker = Awaited<ReturnType<typeof createOcrWorker>>

async function loadMupdf() { return (await import('mupdf')).default }

export class PdfGenerationError extends Error {
  constructor(readonly code: 'resource-limit' | 'unreadable-pdf' | 'render-failed' | 'validation-failed' | 'write-failed', message: string) {
    super(message); this.name = 'PdfGenerationError'
  }
}

export interface SafePdfOptions {
  routing: SaveResult['redactionMode']
  layerKind?: import('@shared/types').PdfLayerKind
  ocrAligned?: boolean
  ocrDpi?: number
  pageSafety?: PdfPageQualityOutcome[]
}

interface Box {
  page: number
  entityId: string
  pseudo: string
  mupdf: Rect
  pixel?: Rect
  pdf?: Rect
  status: 'matched' | 'ambiguous' | 'rejected'
}

export function weightedMedian(samples: readonly { value: number; weight: number }[]): number | null {
  const values = samples.filter((sample) => sample.value > 0 && sample.weight > 0 && Number.isFinite(sample.value) && Number.isFinite(sample.weight)).sort((a, b) => a.value - b.value)
  if (!values.length) return null
  const half = values.reduce((sum, sample) => sum + sample.weight, 0) / 2
  let seen = 0
  for (const sample of values) { seen += sample.weight; if (seen >= half) return sample.value }
  return values.at(-1)!.value
}

export function enforcePixelBudget(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PAGE_PIXELS) {
    throw new PdfGenerationError('resource-limit', 'La pagina supera il limite sicuro di 50 milioni di pixel.')
  }
}

export async function generatePdfSafe(filePath: string, entities: DetectedEntity[], options: SafePdfOptions): Promise<SaveResult> {
  const source = Uint8Array.from(await fs.readFile(filePath))
  return options.routing === 'digital'
    ? digital(filePath, source, entities)
    : flattened(filePath, source, entities, options)
}

export async function generateImagePdfSafe(filePath: string, entities: DetectedEntity[]): Promise<SaveResult> {
  const source = Uint8Array.from(await fs.readFile(filePath))
  const metadata = await sharp(source).metadata()
  if (!metadata.width || !metadata.height) throw new PdfGenerationError('unreadable-pdf', 'Immagine non leggibile.')
  enforcePixelBudget(metadata.width, metadata.height)
  const wrapper = await PDFDocument.create()
  const jpeg = await sharp(source).flatten({ background: '#fff' }).jpeg({ quality: RASTER_JPEG_QUALITY }).toBuffer()
  const image = await wrapper.embedJpg(jpeg)
  const page = wrapper.addPage([metadata.width, metadata.height])
  page.drawImage(image, { x: 0, y: 0, width: metadata.width, height: metadata.height })
  const bytes = await wrapper.save()
  return flattened(filePath, bytes, entities, { routing: 'flattened-scan', layerKind: 'scan-no-text' })
}

function outcomesFor(entities: readonly DetectedEntity[]): Map<string, EntityRedactionOutcome> {
  return new Map(entities.filter((entity) => entity.confirmed).map((entity) => [entity.id, {
    entityId: entity.id,
    expectedOccurrences: Number.isSafeInteger(entity.occurrences) && entity.occurrences >= 0 ? entity.occurrences : null,
    matchedOccurrences: 0, redactedOccurrences: 0, ambiguousOccurrences: 0, rejectedOccurrences: 0,
  }]))
}

function resultFor(outputPath: string, mode: SaveResult['redactionMode'], outcomes: Map<string, EntityRedactionOutcome>, reasonsInput: Iterable<PartialReason>, inputSize: number, outputSize: number): SaveResult {
  const reasons = new Set(reasonsInput)
  for (const outcome of outcomes.values()) {
    const complete = outcome.expectedOccurrences === null ? outcome.redactedOccurrences > 0 : outcome.redactedOccurrences === outcome.expectedOccurrences
    if (!complete) reasons.add(outcome.redactedOccurrences ? 'entity-count-mismatch' : 'entity-unmatched')
    if (outcome.ambiguousOccurrences) reasons.add('ambiguous-overlap')
    if (outcome.rejectedOccurrences) reasons.add('rejected-rectangle')
  }
  const sizeRatio = inputSize ? outputSize / inputSize : 1
  return {
    outputPath, safetyStatus: reasons.size ? 'partial' : 'complete', partialReasons: [...reasons], outcomes: [...outcomes.values()],
    entitiesReplaced: [...outcomes.values()].filter((outcome) => outcome.redactedOccurrences > 0).length,
    redactionMode: mode, sizeRatio, sizeWarning: sizeRatio > 3 || outputSize > 20 * 1024 * 1024,
  }
}

async function digital(filePath: string, source: Uint8Array, entities: DetectedEntity[]): Promise<SaveResult> {
  const mupdf = await loadMupdf()
  let doc: import('mupdf').PDFDocument
  try { doc = new mupdf.PDFDocument(source) } catch { throw new PdfGenerationError('unreadable-pdf', 'PDF non leggibile.') }
  const outcomes = outcomesFor(entities); const boxes: Box[] = []
  try {
    for (let index = 0; index < doc.countPages(); index++) {
      const page = doc.loadPage(index); const bounds = page.getBounds(); const width = bounds[2] - bounds[0]; const height = bounds[3] - bounds[1]
      for (const entity of entities.filter((item) => item.confirmed)) for (const quads of page.search(entity.originalText)) {
        const rect = bbox(quads); outcomes.get(entity.id)!.matchedOccurrences += 1
        if (!acceptable(rect, width, height)) { outcomes.get(entity.id)!.rejectedOccurrences += 1; boxes.push({ page: index, entityId: entity.id, pseudo: entity.pseudonym, mupdf: rect, status: 'rejected' }); continue }
        boxes.push({ page: index, entityId: entity.id, pseudo: entity.pseudonym, mupdf: rect, pdf: mupdfRectToPdfUserSpace(rect, page.getTransform() as AffineMatrix), status: 'matched' })
      }
    }
    ambiguate(boxes, outcomes)
    const byPage = group(boxes.filter((box) => box.status === 'matched'))
    for (const [index, pageBoxes] of byPage) {
      const page = doc.loadPage(index)
      for (const box of pageBoxes) { const annot = page.createAnnotation('Redact'); annot.setRect([box.mupdf.x0, box.mupdf.y0, box.mupdf.x1, box.mupdf.y1]); annot.update() }
      page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE); page.update()
      for (const box of pageBoxes) outcomes.get(box.entityId)!.redactedOccurrences += 1
    }
    const redacted = Uint8Array.from(doc.saveToBuffer('garbage=compact,incremental=no').asUint8Array())
    const bytes = await digitalLabels(redacted, boxes.filter((box) => box.status === 'matched'))
    const draft = resultFor('', 'digital', outcomes, [], source.length, bytes.length)
    const outputPath = await atomicValidatedWrite(filePath, bytes, draft.safetyStatus === 'partial', source, mupdf)
    return { ...draft, outputPath }
  } finally { doc.destroy() }
}

async function flattened(filePath: string, source: Uint8Array, entities: DetectedEntity[], options: SafePdfOptions): Promise<SaveResult> {
  const mupdf = await loadMupdf()
  let doc: import('mupdf').PDFDocument
  try { doc = new mupdf.PDFDocument(source) } catch { throw new PdfGenerationError('unreadable-pdf', 'PDF non leggibile.') }
  if (!doc.countPages()) { doc.destroy(); throw new PdfGenerationError('unreadable-pdf', 'PDF senza pagine.') }
  const output = await PDFDocument.create(); const outcomes = outcomesFor(entities); const reasons = new Set<PartialReason>(); let worker: Worker | null = null
  try {
    for (let index = 0; index < doc.countPages(); index++) {
      const page = doc.loadPage(index); const bounds = page.getBounds(); const pageWidth = bounds[2] - bounds[0]; const pageHeight = bounds[3] - bounds[1]
      const kind = qualityKind(options, index)
      const dpi = kind === 'digital' ? MIXED_DIGITAL_DPI : rasterDpi(page)
      if (!dpi || !Number.isFinite(dpi)) throw new PdfGenerationError('resource-limit', 'DPI della scansione non determinabile in modo affidabile.')
      const matrix = mupdf.Matrix.scale(dpi / PDF_POINTS_PER_INCH, dpi / PDF_POINTS_PER_INCH)
      let pixmap: import('mupdf').Pixmap
      try { pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true) } catch { throw new PdfGenerationError('render-failed', 'Rendering pagina non riuscito.') }
      try {
        const width = pixmap.getWidth(); const height = pixmap.getHeight(); enforcePixelBudget(width, height)
        const boxes: Box[] = []
        if (kind === 'digital' || kind === 'scan-aligned') searchBoxes(page, index, entities, matrix, pixmap, pageWidth, pageHeight, boxes, outcomes)
        else {
          if (kind === 'page-error') reasons.add('analysis-page-error')
          try {
            worker ??= await createOcrWorker()
            const recognized = await worker.recognize(Buffer.from(pixmap.asPNG()), {}, { blocks: true, text: false, hocr: false, tsv: false })
            const words = ocrWords(recognized)
            const matches = matchEntitiesOnPage(words, entities.filter((entity) => entity.confirmed).map((entity) => ({ entityId: entity.id, type: entity.type, originalText: entity.originalText })), { page: index, acceptRect: (rect) => acceptable(rect, width, height) })
            for (const match of matches) {
              if (match.status === 'unmatched') continue
              const outcome = outcomes.get(match.entityId)!; outcome.matchedOccurrences += 1
              if (match.status === 'ambiguous') { outcome.ambiguousOccurrences += 1; continue }
              if (match.status === 'rejected' || !match.box) { outcome.rejectedOccurrences += 1; continue }
              const entity = entities.find((item) => item.id === match.entityId)!
              boxes.push({ page: index, entityId: entity.id, pseudo: entity.pseudonym, pixel: match.box, mupdf: renderedPixelRectToMupdf(match.box, matrix as AffineMatrix, { x: pixmap.getX(), y: pixmap.getY() }), status: 'matched' })
            }
          } catch (error) {
            if (error instanceof PdfGenerationError) throw error
            reasons.add('ocr-page-error'); log.warn('pdfGenerator: OCR pagina fallito', { page: index + 1, code: error instanceof Error ? error.name : 'unknown' })
          }
        }
        ambiguate(boxes, outcomes)
        const active = boxes.filter((box) => box.status === 'matched')
        const pixels = Buffer.from(Uint8Array.from(pixmap.getPixels()))
        if (pixels.length < width * height * 3) throw new PdfGenerationError('render-failed', 'Buffer raster incompleto.')
        const jpeg = await rasterLabels(pixels, width, height, active)
        const embedded = await output.embedJpg(jpeg); const target = output.addPage([pageWidth, pageHeight]); target.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight })
        for (const box of active) outcomes.get(box.entityId)!.redactedOccurrences += 1
      } finally { pixmap.destroy() }
    }
    const bytes = await output.save({ useObjectStreams: true }); const draft = resultFor('', 'flattened-scan', outcomes, reasons, source.length, bytes.length)
    const outputPath = await atomicValidatedWrite(filePath, bytes, draft.safetyStatus === 'partial', source, mupdf)
    return { ...draft, outputPath }
  } finally { if (worker) await worker.terminate(); doc.destroy() }
}

function qualityKind(options: SafePdfOptions, index: number): PdfPageQualityOutcome['status'] {
  return options.pageSafety?.find((page) => page.page === index + 1)?.status
    ?? (options.layerKind === 'digital' ? 'digital' : options.layerKind === 'scan-with-text' && options.ocrAligned ? 'scan-aligned' : options.layerKind?.startsWith('scan') ? 'scan-untrusted' : 'page-error')
}

function rasterDpi(page: import('mupdf').PDFPage): number | null {
  const bounds = page.getBounds(); const pageArea = Math.max(0, (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])); const samples: Array<{ value: number; weight: number }> = []; let coverage = 0
  try { page.toStructuredText('preserve-images').walk({ onImageBlock(box, _matrix, image) {
    const w = box[2] - box[0]; const h = box[3] - box[1]; const area = Math.max(0, w * h)
    if (w <= 1 || h <= 1 || !area) return
    const dpi = Math.sqrt(image.getWidth() / (w / 72) * image.getHeight() / (h / 72))
    if (dpi > 0 && Number.isFinite(dpi)) { samples.push({ value: dpi, weight: area }); coverage += area }
  } }) } catch { return null }
  if (!pageArea || coverage / pageArea < 0.5) return null
  const value = weightedMedian(samples); return value === null ? null : Math.round(value)
}

function searchBoxes(page: import('mupdf').PDFPage, index: number, entities: readonly DetectedEntity[], matrix: import('mupdf').Matrix, pixmap: import('mupdf').Pixmap, width: number, height: number, boxes: Box[], outcomes: Map<string, EntityRedactionOutcome>): void {
  for (const entity of entities.filter((item) => item.confirmed)) for (const quads of page.search(entity.originalText)) {
    const rect = bbox(quads); const outcome = outcomes.get(entity.id)!; outcome.matchedOccurrences += 1
    if (!acceptable(rect, width, height)) { outcome.rejectedOccurrences += 1; boxes.push({ page: index, entityId: entity.id, pseudo: entity.pseudonym, mupdf: rect, status: 'rejected' }); continue }
    const device = transformRect(rect, matrix as AffineMatrix)
    boxes.push({ page: index, entityId: entity.id, pseudo: entity.pseudonym, mupdf: rect, pixel: { x0: device.x0 - pixmap.getX(), y0: device.y0 - pixmap.getY(), x1: device.x1 - pixmap.getX(), y1: device.y1 - pixmap.getY() }, status: 'matched' })
  }
}

function acceptable(rect: Rect, width: number, height: number): boolean { const w = rect.x1 - rect.x0; const h = rect.y1 - rect.y0; return w > 0 && h > 0 && width > 0 && height > 0 && w * h / (width * height) <= MAX_RECT_RATIO }
function overlap(a: Rect, b: Rect): boolean { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 }
function ambiguate(boxes: Box[], outcomes: Map<string, EntityRedactionOutcome>): void {
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) if (boxes[a].page === boxes[b].page && boxes[a].entityId !== boxes[b].entityId && boxes[a].status !== 'rejected' && boxes[b].status !== 'rejected' && overlap(boxes[a].mupdf, boxes[b].mupdf)) {
    if (boxes[a].status !== 'ambiguous') outcomes.get(boxes[a].entityId)!.ambiguousOccurrences += 1
    if (boxes[b].status !== 'ambiguous') outcomes.get(boxes[b].entityId)!.ambiguousOccurrences += 1
    boxes[a].status = 'ambiguous'; boxes[b].status = 'ambiguous'
  }
}

async function rasterLabels(raw: Buffer, width: number, height: number, boxes: readonly Box[]): Promise<Uint8Array> {
  const overlays = boxes.flatMap((box) => {
    if (!box.pixel) return []
    const x = Math.max(0, Math.floor(box.pixel.x0 - 2)); const y = Math.max(0, Math.floor(box.pixel.y0 - 2)); const w = Math.min(width - x, Math.ceil(box.pixel.x1 + 2) - x); const h = Math.min(height - y, Math.ceil(box.pixel.y1 + 2) - y)
    if (w <= 0 || h <= 0) return []
    const safe = box.pseudo.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
    return [{ input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#262626"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="${Math.max(8, Math.min(32, h * 0.58))}" fill="#f2f2f2">${safe}</text></svg>`), left: x, top: y }]
  })
  return sharp(raw, { raw: { width, height, channels: 3 } }).composite(overlays).jpeg({ quality: RASTER_JPEG_QUALITY }).toBuffer()
}

async function digitalLabels(source: Uint8Array, boxes: readonly Box[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source); const font = await doc.embedFont(StandardFonts.Helvetica); const pages = doc.getPages()
  for (const box of boxes) if (box.pdf && pages[box.page]) {
    const w = box.pdf.x1 - box.pdf.x0; const h = box.pdf.y1 - box.pdf.y0; const size = Math.max(5, Math.min(10, h * 0.75)); const page = pages[box.page]
    page.drawRectangle({ x: box.pdf.x0, y: box.pdf.y0, width: w, height: h, color: rgb(0.92, 0.92, 0.92) }); page.drawText(box.pseudo, { x: box.pdf.x0, y: box.pdf.y0 + Math.max(0, (h - size) / 2), size, font, color: rgb(0.2, 0.2, 0.2) })
  }
  return doc.save()
}

async function createOcrWorker() {
  const { createWorker } = await import('tesseract.js'); const data = await fs.readFile(join(getTessdataPath(), 'ita.traineddata')); const lang: import('tesseract.js').Lang = { code: 'ita', data: data as unknown }
  const require = createRequire(import.meta.url); const workerPath = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/node_modules/tesseract.js/src/worker-script/node/index.js') : require.resolve('tesseract.js/src/worker-script/node/index.js')
  return createWorker([lang], 1, { workerPath, cacheMethod: 'none', gzip: false })
}

function ocrWords(result: Awaited<ReturnType<import('tesseract.js').Worker['recognize']>>): MatchWord[] { const words: MatchWord[] = []; let line = 0; for (const block of result.data.blocks ?? []) for (const para of block.paragraphs ?? []) for (const row of para.lines ?? []) { for (const word of row.words ?? []) if (word.text.trim()) words.push({ text: word.text, bbox: word.bbox, line }); line++ } return words }
function bbox(quads: number[][]): Rect { let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; for (const q of quads) for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, q[i]); y0 = Math.min(y0, q[i + 1]); x1 = Math.max(x1, q[i]); y1 = Math.max(y1, q[i + 1]) } return { x0, y0, x1, y1 } }
function group(boxes: readonly Box[]): Map<number, Box[]> { const result = new Map<number, Box[]>(); for (const box of boxes) result.set(box.page, [...(result.get(box.page) ?? []), box]); return result }

async function atomicValidatedWrite(sourcePath: string, bytes: Uint8Array, partial: boolean, source: Uint8Array, mupdf: Mupdf): Promise<string> {
  const dir = path.dirname(sourcePath); const stem = `${path.basename(sourcePath, path.extname(sourcePath))}_anonimizzato${partial ? '_DA_VERIFICARE' : ''}`; const temp = path.join(dir, `.${stem}.${randomBytes(12).toString('hex')}.tmp`)
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx' }); const stored = Uint8Array.from(await fs.readFile(temp)); validateDocument(mupdf, source, stored)
    const output = await availablePath(dir, stem); await fs.rename(temp, output); return output
  } catch (error) { await fs.unlink(temp).catch(() => undefined); if (error instanceof PdfGenerationError) throw error; throw new PdfGenerationError('write-failed', 'Scrittura atomica fallita.') }
}

function validateDocument(mupdf: Mupdf, source: Uint8Array, output: Uint8Array): void {
  let before: import('mupdf').PDFDocument; let after: import('mupdf').PDFDocument
  try { before = new mupdf.PDFDocument(source); after = new mupdf.PDFDocument(output) } catch { throw new PdfGenerationError('validation-failed', 'Output PDF non riapribile.') }
  try {
    if (before.countPages() !== after.countPages()) throw new PdfGenerationError('validation-failed', 'Numero pagine modificato.')
    for (let i = 0; i < before.countPages(); i++) {
      const a = before.loadPage(i).getBounds(); const b = after.loadPage(i).getBounds()
      if (Math.abs((a[2] - a[0]) - (b[2] - b[0])) > 0.5 || Math.abs((a[3] - a[1]) - (b[3] - b[1])) > 0.5) throw new PdfGenerationError('validation-failed', 'Dimensione fisica pagina modificata.')
      const pixmap = after.loadPage(i).toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false, true)
      try { const pixels = pixmap.getPixels(); if (!pixmap.getWidth() || !pixmap.getHeight() || pixels.length < pixmap.getStride() * pixmap.getHeight()) throw new PdfGenerationError('validation-failed', 'Rendering output non valido.'); let dark = 0; for (let y = 0; y < pixmap.getHeight(); y++) for (let x = 0; x < pixmap.getWidth(); x++) if (pixels[y * pixmap.getStride() + x] < 160) dark++; if (dark / (pixmap.getWidth() * pixmap.getHeight()) > 0.95) throw new PdfGenerationError('validation-failed', 'Pagina annerita.') } finally { pixmap.destroy() }
    }
  } finally { before.destroy(); after.destroy() }
}

async function availablePath(dir: string, stem: string): Promise<string> { for (let i = 0; i < 10_000; i++) { const candidate = path.join(dir, `${stem}${i ? `_${i}` : ''}.pdf`); try { await fs.access(candidate) } catch { return candidate } } throw new PdfGenerationError('write-failed', 'Troppi output omonimi.') }
