import type { DocumentFormat, DetectedEntity, PdfLayerKind, SaveResult } from '@shared/types'
import log from 'electron-log'
import { generateTxt } from './txtGenerator'
import { generateDocx } from './docxGenerator'
import { generateOdt } from './odtGenerator'
import { generatePdf, generatePdfFromImage } from './pdfGenerator'
import type { PdfGenerateOptions, RedactionMode } from './pdfGenerator'
import { generateMarkdown } from './markdownGenerator'

/**
 * Risultato di generateOutput.
 *
 * Estende `SaveResult` in modo puramente additivo: i campi diagnostici servono al
 * Renderer per avvisare l'utente (dimensione esplosa, ripiego su overlay). `SaveResult`
 * in @shared/types non viene modificato qui — i campi extra sono strutturalmente
 * compatibili, quindi un chiamante tipizzato su SaveResult continua a compilare.
 */
export interface GenerateOutputResult extends SaveResult {
  sizeRatio?: number
  sizeWarning?: boolean
  redactionMode?: RedactionMode
  fellBackToOverlay?: boolean
}

export interface GenerateOutputOptions {
  isScanned?: boolean
  layerKind?: PdfLayerKind
  ocrAligned?: boolean
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
      return generatePdfFromImage(filePath, entities)

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
  if (options.layerKind !== undefined) return options

  try {
    const { analyzeOcrLayer } = await import('../services/ocrLayerCheck')
    const report = await analyzeOcrLayer(filePath)
    return {
      isScanned: options.isScanned,
      layerKind: report.layerKind,
      // Solo un verdetto esplicitamente 'aligned' abilita il percorso veloce:
      // 'inconclusive' vale quanto 'misaligned' e porta ai box di Tesseract.
      ocrAligned: report.layerKind === 'scan-with-text' && report.verdict === 'aligned',
      ocrDpi: report.suggestedOcrDpi
    }
  } catch (err) {
    // In dubbio si è prudenti: senza report si mantiene il comportamento del chiamante.
    log.warn('generateOutput: analisi layer OCR non riuscita, opzioni invariate', {
      code: err instanceof Error ? err.name : 'unknown'
    })
    return options
  }
}
