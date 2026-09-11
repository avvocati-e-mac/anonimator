import type { DocumentFormat, OcrLayerReport, ProcessDocumentOptions } from '@shared/types'
import log from 'electron-log'
import { parseTxt } from './txtParser'
import { parseDocx } from './docxParser'
import { parseOdt } from './odtParser'
import { parsePdf } from './pdfParser'
import { parseImage, parsePdfWithOcr } from './ocrParser'
import { parseMarkdown } from './markdownParser'
import { analyzeOcrLayer } from '../services/ocrLayerCheck'

export interface ParseResult {
  text: string
  pageCount: number
  warnings: string[]
  isScanned?: boolean  // true se il testo è stato estratto via OCR (PDF scansionato o immagine)
  previewHtml?: string // solo per DOCX: HTML formattato generato da mammoth (undefined per tutti gli altri formati)
  ocrReport?: OcrLayerReport // solo per PDF: esito del controllo su layer OCR, allineamento e qualità
}

/**
 * Rileva il formato del file dall'estensione.
 */
export function detectFormat(filePath: string): DocumentFormat {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const formatMap: Record<string, DocumentFormat> = {
    pdf: 'pdf',
    docx: 'docx',
    odt: 'odt',
    txt: 'txt',
    md: 'markdown',
    png: 'image',
    jpg: 'image',
    jpeg: 'image'
  }
  return formatMap[ext] ?? 'txt'
}

/**
 * Estrae il testo da un PDF, instradando in base alla natura del layer:
 * - `forceOcr`: salta il layer esistente e rilancia direttamente l'OCR interno
 *   (richiesto dall'utente dopo un banner di layer disallineato/assente).
 * - altrimenti: estrae il testo nativo, poi verifica con `analyzeOcrLayer` se si
 *   tratta di una scansione senza alcun layer di testo (serve OCR), di una scansione
 *   con layer OCR già presente (il testo nativo va bene, si allega solo il report) o
 *   di un PDF digitale nativo.
 *
 * Rete di sicurezza: se `analyzeOcrLayer` fallisce o restituisce un `layerKind` non
 * riconosciuto, si ricade sull'euristica `isScanned` di `parsePdf` — il controllo di
 * qualità non deve mai far fallire l'analisi del documento.
 */
async function extractPdfText(filePath: string, opts?: ProcessDocumentOptions): Promise<ParseResult> {
  if (opts?.forceOcr) {
    // DPI gestito da E8: passeremo opts.ocrDpi non appena parsePdfWithOcr lo accetterà.
    const ocrResult = await parsePdfWithOcr(filePath)
    return { ...ocrResult, isScanned: true }
  }

  const pdfResult = await parsePdf(filePath)

  let ocrReport: OcrLayerReport | undefined
  try {
    ocrReport = await analyzeOcrLayer(filePath)
  } catch (err) {
    log.warn('Controllo layer OCR fallito — ricado sull\'euristica isScanned', {
      error: err instanceof Error ? err.message : String(err)
    })
  }

  const layerKind = ocrReport?.layerKind
  const isRecognizedKind =
    layerKind === 'digital' || layerKind === 'scan-with-text' || layerKind === 'scan-no-text'

  if (ocrReport && isRecognizedKind) {
    if (layerKind === 'scan-no-text') {
      // Scansione priva di layer di testo: serve l'OCR interno.
      const ocrResult = await parsePdfWithOcr(filePath)
      return {
        ...ocrResult,
        isScanned: true,
        // Concatena i warning di entrambe le fasi — non scartare quelli di parsePdf.
        warnings: [...pdfResult.warnings, ...ocrResult.warnings],
        ocrReport
      }
    }
    // 'scan-with-text' (layer OCR già presente) o 'digital': il testo nativo va bene.
    return { ...pdfResult, ocrReport }
  }

  // Rete di sicurezza: nessun report attendibile, ricadi sull'euristica isScanned.
  if (pdfResult.isScanned) {
    const ocrResult = await parsePdfWithOcr(filePath)
    return {
      ...ocrResult,
      isScanned: true,
      // Concatena i warning di entrambe le fasi — non scartare quelli di parsePdf.
      warnings: [...pdfResult.warnings, ...ocrResult.warnings]
    }
  }
  return pdfResult
}

/**
 * Estrae il testo dal documento in base al formato.
 * Per i PDF: prima tenta l'estrazione testo nativa; se il documento risulta scansionato,
 * passa automaticamente all'OCR (vedi `extractPdfText`).
 */
export async function extractText(
  filePath: string,
  format: DocumentFormat,
  opts?: ProcessDocumentOptions
): Promise<ParseResult> {
  switch (format) {
    case 'txt':
      return parseTxt(filePath)

    case 'docx':
      return parseDocx(filePath)

    case 'odt':
      return parseOdt(filePath)

    case 'pdf':
      return extractPdfText(filePath, opts)

    case 'image': {
      const imgResult = await parseImage(filePath)
      return { ...imgResult, isScanned: true }
    }

    case 'markdown':
      return parseMarkdown(filePath)

    default: {
      const _exhaustive: never = format
      return { text: '', pageCount: 0, warnings: [`Formato non supportato: ${_exhaustive}`] }
    }
  }
}
