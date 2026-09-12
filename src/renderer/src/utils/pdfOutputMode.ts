import type { DocumentAnalysisResult, PdfOutputMode } from '@shared/types'

export function supportsPdfOutputMode(result: DocumentAnalysisResult | undefined): boolean {
  if (!result) return false
  if (result.format === 'image') return true
  if (result.format !== 'pdf') return false
  return result.isScanned === true
    || (result.ocrReport !== undefined && result.ocrReport.layerKind !== 'digital')
}

export function requiresBitonalAcknowledgement(mode: PdfOutputMode): boolean {
  return mode === 'force-bitonal'
}
