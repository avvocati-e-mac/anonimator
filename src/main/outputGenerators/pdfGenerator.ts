import fs from 'fs/promises'
import path from 'path'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { DetectedEntity } from '@shared/types'
import type { TextToken } from '../parsers/pdfParser'

/**
 * Anonimizza un PDF mantenendo il layout originale.
 * Strategia: per ogni entità confermata, trova i token PDF che la contengono
 * (anche come sottostringa), calcola la posizione x precisa del testo da coprire,
 * disegna un rettangolo bianco e sovrascrive con il pseudonimo.
 */
export async function generatePdf(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const { parsePdf } = await import('../parsers/pdfParser')
  const { tokens } = await parsePdf(filePath)

  const fileBuffer = await fs.readFile(filePath)
  const pdfDoc = await PDFDocument.load(fileBuffer)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const confirmedEntities = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  let entitiesReplaced = 0

  for (const entity of confirmedEntities) {
    const matches = findEntityInTokens(tokens, entity.originalText)
    if (matches.length === 0) continue

    entitiesReplaced++

    for (const match of matches) {
      const pageIndex = match.token.page - 1
      const page = pdfDoc.getPages()[pageIndex]
      if (!page) continue

      const tokenText = match.token.str
      // Stima larghezza carattere in proporzione alla larghezza del token
      const charWidth = match.token.width / Math.max(tokenText.length, 1)
      const matchX = match.token.x + match.startChar * charWidth
      const matchWidth = Math.max(match.matchText.length * charWidth, 20)

      const tokenHeight = match.token.height
      // Padding generoso per coprire completamente il testo originale
      const padX = 1
      const padYBottom = tokenHeight * 0.25
      const padYTop = tokenHeight * 0.35

      const rectX = matchX - padX
      const rectY = match.token.y - padYBottom
      const rectW = matchWidth + padX * 2
      const rectH = tokenHeight + padYBottom + padYTop

      // 1. Rettangolo bianco solido che copre il testo originale
      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectW,
        height: rectH,
        color: rgb(1, 1, 1),
        borderWidth: 0
      })

      // 2. Bordo grigio chiaro per delimitare visivamente la redazione
      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectW,
        height: rectH,
        color: rgb(0.95, 0.95, 0.95),
        borderColor: rgb(0.75, 0.75, 0.75),
        borderWidth: 0.5
      })

      // 3. Pseudonimo centrato verticalmente nel rettangolo
      const fontSize = Math.max(tokenHeight * 0.80, 5)
      page.drawText(entity.pseudonym, {
        x: rectX + 1,
        y: rectY + (rectH - fontSize) / 2,
        size: fontSize,
        font: helvetica,
        color: rgb(0.3, 0.3, 0.3)
      })
    }
  }

  const pdfBytes = await pdfDoc.save()

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.pdf`)

  await fs.writeFile(outputPath, pdfBytes)
  return { outputPath, entitiesReplaced }
}

interface TokenMatch {
  token: TextToken
  startChar: number   // indice del primo carattere del match nel token
  matchText: string   // testo effettivo trovato (preserva case originale)
}

/**
 * Trova tutte le occorrenze dell'entità nei token PDF.
 * Cerca sia match esatti del token che substring all'interno di token più lunghi.
 * Gestisce anche token spezzati a fine riga (es. "Stroz-" + "zi").
 */
function findEntityInTokens(tokens: TextToken[], entityText: string): TokenMatch[] {
  const results: TokenMatch[] = []
  const target = entityText.toLowerCase()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const tokenLower = token.str.toLowerCase()

    // Cerca il target all'interno di questo token
    let searchStart = 0
    while (true) {
      const idx = tokenLower.indexOf(target, searchStart)
      if (idx === -1) break
      results.push({ token, startChar: idx, matchText: token.str.slice(idx, idx + target.length) })
      searchStart = idx + 1
    }

    // Cerca match su token contigui (stesso y ± 2pt, stessa pagina) per testi spezzati
    // es. "Stroz-" sulla riga e "zi" all'inizio della riga successiva
    if (i + 1 < tokens.length) {
      const next = tokens[i + 1]
      if (next.page === token.page) {
        const combined = (token.str + next.str).toLowerCase()
        const idx = combined.indexOf(target)
        if (idx !== -1 && idx < token.str.length) {
          // Il match inizia nel token corrente e finisce nel successivo
          // Copriamo entrambi i token separatamente
          const inFirst = token.str.length - idx
          if (inFirst > 0 && inFirst < target.length) {
            results.push({ token, startChar: idx, matchText: token.str.slice(idx) })
            results.push({ token: next, startChar: 0, matchText: next.str.slice(0, target.length - inFirst) })
          }
        }
      }
    }
  }

  return results
}
