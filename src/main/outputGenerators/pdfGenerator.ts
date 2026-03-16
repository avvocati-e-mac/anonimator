import fs from 'fs/promises'
import path from 'path'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { app } from 'electron'
import type { DetectedEntity } from '@shared/types'
import { getTessdataPath } from '../services/nerService'
import log from 'electron-log'

interface RedactionBox {
  page: number      // 0-based
  x0: number        // coordinate MuPDF (y=0 in alto)
  y0: number
  x1: number
  y1: number
  pageHeight: number  // altezza pagina MuPDF — serve per convertire a pdf-lib (y=0 in basso)
  pseudo: string
}

/**
 * Anonimizza un PDF in due fasi:
 * 1. MuPDF: rimuove fisicamente il testo originale dai layer PDF (non recuperabile)
 * 2. pdf-lib: scrive il testo sostitutivo nelle stesse posizioni su sfondo grigio chiaro
 */
export async function generatePdf(
  filePath: string,
  entities: DetectedEntity[],
  options: { isScanned?: boolean } = {}
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  if (options.isScanned) {
    return generatePdfScanned(filePath, entities)
  }
  const mupdf = (await import('mupdf')).default as typeof import('mupdf')

  const fileBuffer = await fs.readFile(filePath)
  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  // ── Fase 1: MuPDF — rimuove il testo e raccoglie le coordinate ──────────────
  const doc = new mupdf.PDFDocument(fileBuffer as unknown as ArrayBuffer)
  const redactionBoxes: RedactionBox[] = []

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i) as import('mupdf').PDFPage
    let hasRedact = false

    // Altezza pagina in coordinate MuPDF (punti, y=0 in alto)
    const bounds = page.getBounds() as [number, number, number, number]
    const pageHeight = bounds[3] - bounds[1]

    for (const entity of confirmed) {
      const hits = page.search(entity.originalText) as number[][][]
      if (hits.length === 0) continue
      hasRedact = true

      for (const quads of hits) {
        const [x0, y0, x1, y1] = quadsToBbox(quads)
        const annot = page.createAnnotation('Redact')
        annot.setRect([x0, y0, x1, y1])
        annot.setContents(entity.pseudonym)
        annot.update()
        redactionBoxes.push({ page: i, x0, y0, x1, y1, pageHeight, pseudo: entity.pseudonym })
      }
    }

    if (hasRedact) {
      // false = nessun riempimento nero — solo rimozione del testo
      page.applyRedactions(false, 0)
      page.update()
    }
  }

  const mupdfBytes = doc.saveToBuffer('garbage=compact,incremental=no').asUint8Array()

  // ── Fase 2: pdf-lib — disegna testo sostitutivo nelle stesse posizioni ──────
  const pdfDoc = await PDFDocument.load(mupdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  // Raggruppa le box per pagina
  const boxesByPage = new Map<number, RedactionBox[]>()
  for (const box of redactionBoxes) {
    if (!boxesByPage.has(box.page)) boxesByPage.set(box.page, [])
    boxesByPage.get(box.page)!.push(box)
  }

  for (const [pageIdx, boxes] of boxesByPage) {
    const page = pages[pageIdx]
    if (!page) continue

    for (const box of boxes) {
      const w = box.x1 - box.x0
      const h = box.y1 - box.y0
      if (w <= 0 || h <= 0) continue

      // Conversione coordinate: MuPDF (y=0 alto, crescente verso il basso)
      //   → pdf-lib (y=0 basso, crescente verso l'alto)
      // In MuPDF: y0 = bordo superiore, y1 = bordo inferiore (y1 > y0)
      // In pdf-lib: y = bordo inferiore del rettangolo
      const pdfY = box.pageHeight - box.y1

      // Sfondo grigio chiaro
      page.drawRectangle({
        x: box.x0,
        y: pdfY,
        width: w,
        height: h,
        color: rgb(0.92, 0.92, 0.92),
        borderWidth: 0
      })

      // Testo pseudonimo centrato verticalmente, dimensione proporzionale all'altezza
      const fontSize = Math.min(Math.max(h * 0.75, 5), 10)
      const textWidth = font.widthOfTextAtSize(box.pseudo, fontSize)
      const textX = box.x0 + Math.max((w - textWidth) / 2, 0)
      const textY = pdfY + (h - fontSize) / 2

      page.drawText(box.pseudo, {
        x: textX,
        y: textY,
        size: fontSize,
        font,
        color: rgb(0.2, 0.2, 0.2)
      })
    }
  }

  const finalBytes = await pdfDoc.save()

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.pdf`)

  await fs.writeFile(outputPath, finalBytes)
  return { outputPath, entitiesReplaced: new Set(redactionBoxes.map((b) => b.pseudo)).size }
}

/**
 * Anonimizza un PDF scansionato (immagini raster).
 * Strategia: per ogni pagina, renderizza con MuPDF → OCR con Tesseract (word-level boxes)
 * → sovrappone rettangoli grigi sulle parole che corrispondono alle entità da oscurare.
 */
async function generatePdfScanned(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const { createWorker } = await import('tesseract.js')
  const mupdf = (await import('mupdf')).default as typeof import('mupdf')

  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  if (confirmed.length === 0) {
    // Nessuna entità da oscurare: copia il file originale come output
    const dir = path.dirname(filePath)
    const base = path.basename(filePath, path.extname(filePath))
    const outputPath = path.join(dir, `${base}_anonimizzato.pdf`)
    await fs.copyFile(filePath, outputPath)
    return { outputPath, entitiesReplaced: 0 }
  }

  const OCR_DPI = 150
  const PDF_POINTS_PER_INCH = 72
  const scale = OCR_DPI / PDF_POINTS_PER_INCH

  const tessDataDir = getTessdataPath()
  const trainedDataBuffer = await fs.readFile(join(tessDataDir, 'ita.traineddata'))
  const langData: import('tesseract.js').Lang = { code: 'ita', data: trainedDataBuffer as unknown }

  const _require = createRequire(import.meta.url)
  const workerPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules',
        'tesseract.js/src/worker-script/node/index.js')
    : _require.resolve('tesseract.js/src/worker-script/node/index.js')

  const worker = await createWorker([langData], 1, {
    workerPath,
    cacheMethod: 'none' as const,
    gzip: false,
    errorHandler: (err: unknown) => { /* silenzioso — già gestito nel catch */ void err },
  })

  const fileBuffer = await fs.readFile(filePath)
  const doc = new mupdf.PDFDocument(fileBuffer as unknown as ArrayBuffer)
  const pageCount = doc.countPages()

  // Carica il PDF originale in pdf-lib per disegnare i rettangoli
  const pdfDoc = await PDFDocument.load(fileBuffer)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pdfPages = pdfDoc.getPages()

  let entitiesReplaced = 0
  const tempFiles: string[] = []

  try {
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i) as import('mupdf').PDFPage
      const bounds = page.getBounds() as [number, number, number, number]
      const pageHeightPt = bounds[3] - bounds[1]

      // Renderizza pagina in PNG via MuPDF
      const matrix = mupdf.Matrix.scale(scale, scale)
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false)
      const pngBuffer = Buffer.from(pixmap.asPNG())

      // Scrivi temp file PNG per Tesseract
      const tempPath = join(tmpdir(), `ocr_redact_${randomBytes(8).toString('hex')}.png`)
      await fs.writeFile(tempPath, pngBuffer)
      tempFiles.push(tempPath)

      // OCR con blocks=true per ottenere word-level bounding boxes
      const result = await worker.recognize(tempPath, {}, {
        blocks: true, text: false, hocr: false, tsv: false,
      })

      // Estrai tutte le parole da tutti i blocchi/paragrafi/linee
      type TessWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
      const words: TessWord[] = []
      for (const block of result.data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            for (const word of line.words ?? []) {
              if (word.text.trim()) words.push({ text: word.text, bbox: word.bbox })
            }
          }
        }
      }

      log.info(`PDF scansionato pag ${i + 1}: parole OCR estratte`, {
        wordCount: words.length,
        sample: words.slice(0, 5).map((w) => w.text)
      })

      const pdfPage = pdfPages[i]
      if (!pdfPage) continue

      // Normalizza: rimuove punteggiatura esterna e spazi extra
      const normalize = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()

      // Per ogni entità confermata, cerca corrispondenze nelle parole OCR
      const entityHits = new Set<string>()
      for (const entity of confirmed) {
        const searchText = normalize(entity.originalText)
        // Raggruppa parole consecutive in finestre per trovare frasi multi-parola
        for (let w = 0; w < words.length; w++) {
          // Prova a formare la frase con parole consecutive
          let phrase = ''
          let wEnd = w
          const firstWordCenterY = (words[w].bbox.y0 + words[w].bbox.y1) / 2
          for (let j = w; j < words.length && phrase.length <= searchText.length + 10; j++) {
            const wordNorm = normalize(words[j].text)
            if (!wordNorm) continue
            // Salta se la parola è su una riga diversa (centro Y distante più di 1.5x altezza parola)
            const wordCenterY = (words[j].bbox.y0 + words[j].bbox.y1) / 2
            const wordHeight = words[j].bbox.y1 - words[j].bbox.y0
            if (Math.abs(wordCenterY - firstWordCenterY) > wordHeight * 1.5) break
            phrase = phrase ? phrase + ' ' + wordNorm : wordNorm
            if (phrase === searchText) {
              // Match trovato: calcola bbox unione delle parole w..j
              const matchWords = words.slice(w, j + 1)
              const x0Px = Math.min(...matchWords.map((wd) => wd.bbox.x0))
              const y0Px = Math.min(...matchWords.map((wd) => wd.bbox.y0))
              const x1Px = Math.max(...matchWords.map((wd) => wd.bbox.x1))
              const y1Px = Math.max(...matchWords.map((wd) => wd.bbox.y1))

              // Converti da pixel OCR a punti PDF, con padding di 1pt
              const PAD = 1
              const x0Pt = (x0Px / scale) + bounds[0] - PAD
              const y0Pt = (y0Px / scale) + bounds[1] - PAD
              const x1Pt = (x1Px / scale) + bounds[0] + PAD
              const y1Pt = (y1Px / scale) + bounds[1] + PAD

              const rectW = x1Pt - x0Pt
              const rectH = y1Pt - y0Pt

              // pdf-lib: y=0 in basso
              const pdfY = pageHeightPt - y1Pt

              // Rettangolo grigio di copertura
              pdfPage.drawRectangle({
                x: x0Pt, y: pdfY, width: rectW, height: rectH,
                color: rgb(0.15, 0.15, 0.15),
                borderWidth: 0,
              })

              // Pseudonimo
              const fontSize = Math.min(Math.max(rectH * 0.65, 5), 9)
              const textWidth = font.widthOfTextAtSize(entity.pseudonym, fontSize)
              pdfPage.drawText(entity.pseudonym, {
                x: x0Pt + Math.max((rectW - textWidth) / 2, 1),
                y: pdfY + (rectH - fontSize) / 2,
                size: fontSize, font, color: rgb(0.95, 0.95, 0.95),
              })

              entityHits.add(entity.originalText)
              wEnd = j
              break
            }
          }
          w = wEnd
        }
      }
      entitiesReplaced = entityHits.size
    }
  } finally {
    await worker.terminate()
    for (const f of tempFiles) {
      await fs.unlink(f).catch(() => { /* ignora */ })
    }
  }

  const finalBytes = await pdfDoc.save()
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.pdf`)
  await fs.writeFile(outputPath, finalBytes)
  return { outputPath, entitiesReplaced }
}

function quadsToBbox(quads: number[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const q of quads) {
    for (let i = 0; i < 8; i += 2) {
      x0 = Math.min(x0, q[i])
      x1 = Math.max(x1, q[i])
      y0 = Math.min(y0, q[i + 1])
      y1 = Math.max(y1, q[i + 1])
    }
  }
  return [x0, y0, x1, y1]
}
