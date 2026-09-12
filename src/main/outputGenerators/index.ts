import type { DocumentFormat, DetectedEntity, PdfLayerKind, PdfOutputMode, SaveResult } from '@shared/types'
import { privacyLog as log, safeErrorCode } from '../services/privacyLogger'
import { generateTxt } from './txtGenerator'
import { generateDocx } from './docxGenerator'
import { generateOdt } from './odtGenerator'
import { generatePdf, generatePdfFromImage } from './pdfGenerator'
import type { PdfGenerateOptions } from './pdfGenerator'
import { generateMarkdown } from './markdownGenerator'
import { resolvePdfRasterCodec } from '../services/rasterCodecConfig'

/**
 * Risultato di generateOutput.
 *
 * Estende `SaveResult` in modo puramente additivo: i campi diagnostici servono al
 * Renderer per avvisare l'utente (dimensione esplosa o output parziale). `SaveResult`
 * in @shared/types non viene modificato qui — i campi extra sono strutturalmente
 * compatibili, quindi un chiamante tipizzato su SaveResult continua a compilare.
 */
export type GenerateOutputResult = SaveResult | {
  outputPath: string
  entitiesReplaced: number
  sizeRatio?: number
  sizeWarning?: boolean
  /** I formati non-PDF non hanno un percorso di redazione PDF. */
  redactionMode?: undefined
}

export interface GenerateOutputOptions {
  isScanned?: boolean
  layerKind?: PdfLayerKind
  ocrAligned?: boolean
  /** Capability Main-only; non fa parte del payload Renderer dopo la validazione IPC. */
  analysisToken?: string
  /** Preferenza utente validata dall'IPC; non contiene dettagli del codec. */
  pdfOutputMode?: PdfOutputMode
}

/**
 * Genera il file anonimizzato nel formato appropriato.
 * Ritorna il path del file di output e il numero di entità sostituite.
 */
export async function generateOutput(
  filePath: string,
  format: DocumentFormat,
  entities: DetectedEntity[],
  options: GenerateOutputOptions = {}
): Promise<GenerateOutputResult> {
  switch (format) {
    case 'txt':
      return generateTxt(filePath, entities)

    case 'docx':
      return generateDocx(filePath, entities)

    case 'odt':
      return generateOdt(filePath, entities)

    case 'pdf':
      return generatePdf(filePath, entities, await resolvePdfOptions(filePath, options))

    case 'image':
      // Un PNG/JPG non è un PDF: prima veniva passato a generatePdf, che lo apriva come
      // documento PDF e sollevava eccezione. Va incapsulato e redatto come scansione.
      return generatePdfFromImage(filePath, entities, {
        analysisToken: options.analysisToken,
        rasterCodec: resolvePdfRasterCodec(options.pdfOutputMode),
      })

    case 'markdown':
      return generateMarkdown(filePath, entities)

    default: {
      const _exhaustive: never = format
      throw new Error(`Formato output non supportato: ${_exhaustive}`)
    }
  }
}

/**
 * Completa le opzioni di redazione quando il chiamante non porta `layerKind`.
 *
 * PERCHÉ SERVE: `BatchAnonymizeRequest` non trasporta `layerKind`, quindi le scansioni
 * anonimizzate in batch prenderebbero il percorso sbagliato e continuerebbero a
 * lasciare i dati personali nei pixel. Una correzione di privacy che funziona in uno
 * solo dei due flussi è peggio che non spedirla: qui il dato mancante viene ricavato
 * da sé. L'import è dinamico perché ocrLayerCheck carica MuPDF (CLAUDE.md, Livello 2).
 */
async function resolvePdfOptions(
  filePath: string,
  options: GenerateOutputOptions
): Promise<PdfGenerateOptions> {
  try {
    const { analyzePdfQuality } = await import('../services/ocrLayerCheck')
    const { report, safety } = await analyzePdfQuality(filePath)
    return {
      isScanned: options.isScanned,
      layerKind: report.layerKind,
      ocrAligned: safety.existingTextLayerUsable,
      ocrDpi: report.suggestedOcrDpi,
      routing: safety.routing,
      pageSafety: safety.pages,
      analysisToken: options.analysisToken,
      rasterCodec: resolvePdfRasterCodec(options.pdfOutputMode),
    }
  } catch (err) {
    if (options.pdfOutputMode === 'force-bitonal') {
      throw err
    }
    // In dubbio si è prudenti: senza report si mantiene il comportamento del chiamante.
    log.warn('generateOutput: analisi layer OCR non riuscita, opzioni invariate', {
      stage: 'output',
      errorCode: safeErrorCode(err),
    })
    return { ...options, routing: 'flattened-scan' }
  }
}
