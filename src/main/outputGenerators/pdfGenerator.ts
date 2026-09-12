import type { DetectedEntity, PdfLayerKind, SaveResult } from '@shared/types'
import type { PdfPageQualityOutcome } from '../services/ocrLayerCheck'
import { generateImagePdfSafe, generatePdfSafe } from './pdfSafeGenerator'

/**
 * Façade pubblico della generazione PDF.
 *
 * La sola implementazione di produzione vive in `pdfSafeGenerator.ts`: i PDF
 * raster o misti vengono sempre ricostruiti e nessun errore può degradare a un
 * overlay del documento originale. Il routing è obbligatorio per impedire che
 * l'assenza di una diagnosi venga interpretata implicitamente come PDF digitale.
 */
export interface PdfGenerateOptions {
  routing: SaveResult['redactionMode']
  isScanned?: boolean
  layerKind?: PdfLayerKind
  ocrAligned?: boolean
  ocrDpi?: number
  pageSafety?: PdfPageQualityOutcome[]
  /** Opt-in Main-only; il default resta JPEG e il valore non attraversa l'IPC. */
  rasterCodec?: 'jpeg' | 'bitonal-auto' | 'bitonal-force'
  /** Capability Main-only necessaria per recuperare l'artefatto OCR in RAM. */
  analysisToken?: string
}

export type PdfSaveResult = SaveResult

export async function generatePdf(
  filePath: string,
  entities: DetectedEntity[],
  options: PdfGenerateOptions,
): Promise<PdfSaveResult> {
  return generatePdfSafe(filePath, entities, options)
}

/** Incapsula PNG/JPG e delega alla stessa pipeline raster fail-closed. */
export async function generatePdfFromImage(
  filePath: string,
  entities: DetectedEntity[],
  options: Pick<PdfGenerateOptions, 'analysisToken' | 'rasterCodec'> = {},
): Promise<PdfSaveResult> {
  return generateImagePdfSafe(filePath, entities, options)
}
