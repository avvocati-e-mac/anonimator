import type { DocumentFormat } from '@shared/types'
import { parseTxt } from './txtParser'
import { parseDocx } from './docxParser'
import { parseOdt } from './odtParser'
import { parsePdf } from './pdfParser'
import { parseImage, parsePdfWithOcr } from './ocrParser'
import { parseMarkdown } from './markdownParser'

export interface ParseResult {
  text: string
  pageCount: number
  warnings: string[]
  isScanned?: boolean  // true se il testo è stato estratto via OCR (PDF scansionato o immagine)
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
 * Estrae il testo dal documento in base al formato.
 * Per i PDF: prima tenta l'estrazione testo nativa; se il documento risulta scansionato,
 * passa automaticamente all'OCR.
 */
export async function extractText(filePath: string, format: DocumentFormat): Promise<ParseResult> {
  switch (format) {
    case 'txt':
      return parseTxt(filePath)

    case 'docx':
      return parseDocx(filePath)

    case 'odt':
      return parseOdt(filePath)

    case 'pdf': {
      const pdfResult = await parsePdf(filePath)
      if (pdfResult.isScanned) {
        // PDF scansionato: rilancia con OCR, propaga isScanned=true
        const ocrResult = await parsePdfWithOcr(filePath)
        return { ...ocrResult, isScanned: true }
      }
      return pdfResult
    }

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
