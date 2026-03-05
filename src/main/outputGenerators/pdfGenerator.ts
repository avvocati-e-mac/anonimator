import fs from 'fs/promises'
import path from 'path'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { DetectedEntity } from '@shared/types'

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
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
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
