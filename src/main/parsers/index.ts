import type { DocumentFormat, OcrLayerReport, ProcessDocumentOptions } from '@shared/types'
import { privacyLog as log, safeErrorCode } from '../services/privacyLogger'
import { parseTxt } from './txtParser'
import { parseDocx } from './docxParser'
import { parseOdt } from './odtParser'
import { parsePdf } from './pdfParser'
import { parseImage, parsePdfWithOcr, type OcrParseOptions } from './ocrParser'
import { parseMarkdown } from './markdownParser'
import {
  analyzePdfQuality,
  type PdfDocumentSafety,
  type PdfQualityAnalysis,
} from '../services/ocrLayerCheck'
import { scoreTextQuality } from '../services/textQuality'

/**
 * Avanzamento dell'OCR interno, pagina per pagina. Solo numeri: e' un canale
 * verso l'interfaccia e non deve trasportare nulla del documento.
 */
export type OcrPageProgress = (page: number, totalPages: number) => void

export interface ParseResult {
  text: string
  pageCount: number
  warnings: string[]
  isScanned?: boolean  // true se il testo è stato estratto via OCR (PDF scansionato o immagine)
  previewHtml?: string // solo per DOCX: HTML formattato generato da mammoth (undefined per tutti gli altri formati)
  ocrReport?: OcrLayerReport // solo per PDF: esito del controllo su layer OCR, allineamento e qualità
  /** Routing Main-only per pagina; non viene serializzato verso il Renderer. */
  pdfSafety?: PdfDocumentSafety
  /** Handle Main-only: non deve mai essere incluso nella risposta IPC. */
  ocrArtifactHandle?: string
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
 * Esegue il controllo del layer OCR senza mai propagare eccezioni: un difetto
 * del rilevatore non deve poter far fallire l'analisi di un documento (R12 del
 * piano). In caso di errore si ritorna `undefined` e il chiamante ricade sulle
 * euristiche preesistenti.
 */
async function analyzeOcrLayerSafe(filePath: string): Promise<PdfQualityAnalysis | undefined> {
  try {
    return await analyzePdfQuality(filePath)
  } catch (err) {
    log.warn('ocr-layer-check-failed-heuristic-fallback', {
      stage: 'ocr',
      errorCode: safeErrorCode(err),
    })
    return undefined
  }
}

/**
 * Traduce il report di analisi nelle opzioni di rendering dell'OCR interno.
 *
 * È il punto in cui le misure fatte sull'immagine diventano azioni concrete:
 * senza questa funzione `skewDeg` e `unevenLighting` di `OcrParseOptions`
 * resterebbero parametri senza alcun chiamante, e due dei tre rimedi previsti
 * dal piano (deskew al rendering e binarizzazione Sauvola) non entrerebbero
 * mai in funzione.
 *
 * `dpiOverride` (quello che arriva dalla richiesta IPC) ha la precedenza sul
 * valore suggerito dal report: è la scelta esplicita del chiamante.
 */
export function buildOcrParseOptions(
  report: OcrLayerReport | undefined,
  dpiOverride?: number,
  onPageProgress?: OcrPageProgress
): OcrParseOptions {
  return {
    dpi: dpiOverride ?? report?.suggestedOcrDpi,
    onPageProgress,
    skewDeg: report?.imageMetrics.skewDeg,
    // Sauvola solo quando la separabilità inchiostro/carta è risultata bassa:
    // su una scansione pulita la pre-binarizzazione toglie al motore LSTM
    // l'informazione in scala di grigi e peggiora il risultato.
    unevenLighting: report?.imageQualityReasons.includes('low-separability') ?? false
  }
}

/**
 * Adatta il report al mondo dopo un OCR rifatto da noi.
 *
 * Tre cose cambiano e una no:
 * - `layerKind` diventa `scan-no-text` e `verdict` `inconclusive`, perché il
 *   layer preesistente non viene più usato. Dichiararlo `aligned` sarebbe
 *   peggio che inutile: instraderebbe l'output sul percorso veloce
 *   `page.search()` sopra un layer che non stiamo più leggendo. Questa coppia
 *   porta invece la redazione sui riquadri di Tesseract, auto-consistenti per
 *   costruzione, e — per la regola R1 — non mostra alcun banner.
 * - `textQuality` si ricalcola sul testo che abbiamo appena prodotto noi: un
 *   OCR venuto male va segnalato, non dato per buono perché è nostro.
 * - la qualità dell'immagine **resta quella misurata**: una scansione a 100 DPI
 *   lo è ancora dopo il nuovo OCR, e l'avviso "verificare a mano" deve
 *   sopravvivere.
 */
export function reportAfterForcedOcr(
  base: OcrLayerReport | undefined,
  ocrText: string
): OcrLayerReport | undefined {
  if (!base) return undefined
  const quality = scoreTextQuality(ocrText)
  return {
    ...base,
    layerKind: 'scan-no-text',
    verdict: 'inconclusive',
    pagesMisaligned: 0,
    pagesInconclusive: base.pagesSampled,
    maxOffsetMm: 0,
    producerFont: null,
    pages: [],
    textQuality: quality.verdict,
    textQualityReasons: quality.reasons
  }
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
async function extractPdfText(
  filePath: string,
  opts?: ProcessDocumentOptions,
  onOcrProgress?: OcrPageProgress
): Promise<ParseResult> {
  if (opts?.forceOcr) {
    // Si rianalizza l'immagine anche qui, prima di rifare l'OCR. Costa
    // ~150-300 ms su un percorso in cui l'utente sta già aspettando minuti, e
    // in cambio dà al rendering l'inclinazione da correggere e la separabilità
    // che decide fra Otsu e Sauvola.
    const preAnalysis = await analyzeOcrLayerSafe(filePath)
    const preReport = preAnalysis?.report
    const ocrResult = await parsePdfWithOcr(
      filePath,
      buildOcrParseOptions(preReport, opts.ocrDpi, onOcrProgress)
    )
    return {
      ...ocrResult,
      isScanned: true,
      ocrReport: reportAfterForcedOcr(preReport, ocrResult.text),
      pdfSafety: preAnalysis?.safety
    }
  }

  const pdfResult = await parsePdf(filePath)
  const qualityAnalysis = await analyzeOcrLayerSafe(filePath)
  const ocrReport = qualityAnalysis?.report
  const pdfSafety = qualityAnalysis?.safety

  const layerKind = ocrReport?.layerKind
  const isRecognizedKind =
    layerKind === 'digital' || layerKind === 'scan-with-text' || layerKind === 'scan-no-text'

  if (ocrReport && isRecognizedKind) {
    if (layerKind === 'scan-no-text') {
      // Scansione priva di layer di testo: serve l'OCR interno.
      const ocrResult = await parsePdfWithOcr(
        filePath,
        buildOcrParseOptions(ocrReport, undefined, onOcrProgress)
      )
      return {
        ...ocrResult,
        isScanned: true,
        // Concatena i warning di entrambe le fasi — non scartare quelli di parsePdf.
        warnings: [...pdfResult.warnings, ...ocrResult.warnings],
        // Il testo ora è il nostro, quindi anche qui il giudizio linguistico va
        // rifatto su ciò che abbiamo prodotto noi.
        ocrReport: reportAfterForcedOcr(ocrReport, ocrResult.text),
        pdfSafety
      }
    }
    // 'scan-with-text' (layer OCR già presente) o 'digital': il testo nativo va bene.
    return { ...pdfResult, ocrReport, pdfSafety }
  }

  // Rete di sicurezza: nessun report attendibile, ricadi sull'euristica isScanned.
  if (pdfResult.isScanned) {
    const ocrResult = await parsePdfWithOcr(filePath, { onPageProgress: onOcrProgress })
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
  opts?: ProcessDocumentOptions,
  onOcrProgress?: OcrPageProgress
): Promise<ParseResult> {
  switch (format) {
    case 'txt':
      return parseTxt(filePath)

    case 'docx':
      return parseDocx(filePath)

    case 'odt':
      return parseOdt(filePath)

    case 'pdf':
      return extractPdfText(filePath, opts, onOcrProgress)

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
