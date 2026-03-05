import type { DocumentFormat, DetectedEntity, SaveResult } from '@shared/types'
import { generateTxt } from './txtGenerator'
import { generateDocx } from './docxGenerator'
import { generateOdt } from './odtGenerator'
import { generatePdf } from './pdfGenerator'

/**
 * Genera il file anonimizzato nel formato appropriato.
 * Ritorna il path del file di output e il numero di entità sostituite.
 */
export async function generateOutput(
  filePath: string,
  format: DocumentFormat,
  entities: DetectedEntity[]
): Promise<SaveResult> {
  switch (format) {
    case 'txt':
      return generateTxt(filePath, entities)

    case 'docx':
      return generateDocx(filePath, entities)

    case 'odt':
      return generateOdt(filePath, entities)

    case 'pdf':
    case 'image': // le immagini sono già state OCR-izzate → output come PDF
      return generatePdf(filePath, entities)

    default: {
      const _exhaustive: never = format
      throw new Error(`Formato output non supportato: ${_exhaustive}`)
    }
  }
}
