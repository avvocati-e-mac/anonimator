import fs from 'fs/promises'
import path from 'path'
import type { DetectedEntity } from '@shared/types'

/**
 * Anonimizza un PDF rimuovendo fisicamente il testo dai layer PDF.
 * Usa MuPDF (WASM) con redaction annotations native:
 *   1. page.search(text) → coordinate di ogni occorrenza
 *   2. createAnnotation('Redact') + setRect() → aggiunge l'annotazione
 *   3. page.applyRedactions() → rimuove il testo dal layer PDF (non recuperabile)
 */
export async function generatePdf(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  // mupdf è un modulo WASM con top-level await — va importato dinamicamente
  const mupdf = (await import('mupdf')).default as typeof import('mupdf')

  const fileBuffer = await fs.readFile(filePath)
  const doc = new mupdf.PDFDocument(fileBuffer as unknown as ArrayBuffer)

  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  let entitiesReplaced = 0
  const pageCount = doc.countPages()

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i) as import('mupdf').PDFPage
    let pageHasRedactions = false

    for (const entity of confirmed) {
      const hits = page.search(entity.originalText) as number[][][]
      if (hits.length === 0) continue

      if (!pageHasRedactions) pageHasRedactions = true
      entitiesReplaced++

      for (const quads of hits) {
        const bbox = quadsToBbox(quads)
        const annot = page.createAnnotation('Redact')
        annot.setRect(bbox)
        annot.setContents(entity.pseudonym)
        annot.update()
      }
    }

    if (pageHasRedactions) {
      // 0 = REDACT_IMAGE_NONE: non tocca le immagini embedded
      page.applyRedactions(true, 0)
      page.update()
    }
  }

  const outBuffer = doc.saveToBuffer('garbage=compact,incremental=no')

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.pdf`)

  await fs.writeFile(outputPath, Buffer.from(outBuffer.asUint8Array()))
  return { outputPath, entitiesReplaced }
}

/**
 * Converte un array di quad in bounding box [x0, y0, x1, y1].
 * page.search() restituisce array di hit, ogni hit è array di quad,
 * ogni quad è array piatto di 8 numeri [x0,y0, x1,y1, x2,y2, x3,y3].
 */
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
