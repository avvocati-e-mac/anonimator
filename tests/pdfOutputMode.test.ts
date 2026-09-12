import { describe, expect, it } from 'vitest'
import type { DocumentAnalysisResult } from '../src/shared/types'
import {
  requiresBitonalAcknowledgement,
  supportsPdfOutputMode,
} from '../src/renderer/src/utils/pdfOutputMode'

function result(patch: Partial<DocumentAnalysisResult>): DocumentAnalysisResult {
  return {
    analysisToken: 'synthetic-token',
    fileName: 'synthetic.png',
    format: 'image',
    pageCount: 1,
    entities: [],
    warnings: [],
    ...patch,
  }
}

describe('modalità output PDF', () => {
  it('offre la scelta per immagini e PDF scansionati, non per formati testuali', () => {
    expect(supportsPdfOutputMode(result({ format: 'image' }))).toBe(true)
    expect(supportsPdfOutputMode(result({ format: 'pdf', isScanned: true }))).toBe(true)
    expect(supportsPdfOutputMode(result({
      format: 'pdf',
      isScanned: false,
      ocrReport: { layerKind: 'digital' } as DocumentAnalysisResult['ocrReport'],
    }))).toBe(false)
    expect(supportsPdfOutputMode(result({ format: 'pdf', isScanned: false }))).toBe(false)
    expect(supportsPdfOutputMode(result({ format: 'txt' }))).toBe(false)
  })

  it('richiede conferma soltanto per la conversione forzata', () => {
    expect(requiresBitonalAcknowledgement('preserve-color')).toBe(false)
    expect(requiresBitonalAcknowledgement('force-bitonal')).toBe(true)
  })
})
