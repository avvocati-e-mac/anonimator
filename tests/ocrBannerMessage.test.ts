import { describe, it, expect } from 'vitest'
import { selectOcrBannerMessage } from '../src/renderer/src/utils/ocrBannerMessage'
import type {
  ImageQualityMetrics,
  ImageQualityReason,
  OcrLayerReport,
  TextQualityReason,
} from '../src/shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_METRICS: ImageQualityMetrics = {
  nativeDpi: 300,
  xHeightPx: 22,
  separability: 0.8,
  skewDeg: 0.2,
  blurScore: 0.9,
}

function makeReport(overrides: Partial<OcrLayerReport> = {}): OcrLayerReport {
  return {
    layerKind: 'scan-with-text',
    verdict: 'aligned',
    pagesSampled: 3,
    pagesMisaligned: 0,
    pagesInconclusive: 0,
    maxOffsetMm: 0,
    producerFont: null,
    pages: [],
    textQuality: 'good',
    textQualityReasons: [],
    imageQuality: 'good',
    imageQualityReasons: [],
    imageMetrics: BASE_METRICS,
    suggestedOcrDpi: 300,
    elapsedMs: 100,
    ...overrides,
  }
}

// ─── Casi che non producono banner ─────────────────────────────────────────────

describe('selectOcrBannerMessage — nessun banner', () => {
  it('restituisce null quando il report è assente', () => {
    expect(selectOcrBannerMessage(undefined, 5)).toBeNull()
  })

  it('restituisce null per PDF digitale (layerKind digital)', () => {
    const report = makeReport({ layerKind: 'digital' })
    expect(selectOcrBannerMessage(report, 5)).toBeNull()
  })

  it('restituisce null quando tutto è a posto', () => {
    const report = makeReport()
    expect(selectOcrBannerMessage(report, 5)).toBeNull()
  })

  it('restituisce null per verdetto inconclusive con qualità testo e immagine buone', () => {
    const report = makeReport({ verdict: 'inconclusive', pagesInconclusive: 3 })
    expect(selectOcrBannerMessage(report, 5)).toBeNull()
  })
})

// ─── imageQuality poor ──────────────────────────────────────────────────────────

describe('selectOcrBannerMessage — immagine di qualità pessima', () => {
  it('è critical e non offre il pulsante di rifacimento OCR', () => {
    const report = makeReport({
      imageQuality: 'poor',
      imageQualityReasons: ['very-low-native-dpi'] as ImageQualityReason[],
      imageMetrics: { ...BASE_METRICS, nativeDpi: 96 },
    })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg).not.toBeNull()
    expect(msg?.severity).toBe('critical')
    expect(msg?.showRedoButton).toBe(false)
    expect(msg?.estimatedMinutes).toBeNull()
  })

  it('resta critical senza pulsante anche se il verdetto è misaligned', () => {
    const report = makeReport({
      verdict: 'misaligned',
      maxOffsetMm: 5,
      imageQuality: 'poor',
      imageMetrics: { ...BASE_METRICS, nativeDpi: 90 },
    })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg?.severity).toBe('critical')
    expect(msg?.showRedoButton).toBe(false)
  })

  it('menziona il DPI nativo quando disponibile', () => {
    const report = makeReport({
      imageQuality: 'poor',
      imageMetrics: { ...BASE_METRICS, nativeDpi: 96 },
    })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg?.body).toContain('96')
  })

  it('non fallisce quando il DPI nativo non è ricavabile (null)', () => {
    const report = makeReport({
      imageQuality: 'poor',
      imageMetrics: { ...BASE_METRICS, nativeDpi: null },
    })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg).not.toBeNull()
    expect(msg?.showRedoButton).toBe(false)
  })
})

// ─── verdict misaligned ─────────────────────────────────────────────────────────

describe('selectOcrBannerMessage — testo e immagine disallineati', () => {
  it('è warning e offre il pulsante di rifacimento OCR', () => {
    const report = makeReport({ verdict: 'misaligned', maxOffsetMm: 4, pagesMisaligned: 2 })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg?.severity).toBe('warning')
    expect(msg?.showRedoButton).toBe(true)
    expect(msg?.estimatedMinutes).not.toBeNull()
  })

  it('riporta lo scostamento in mm nel testo', () => {
    const report = makeReport({ verdict: 'misaligned', maxOffsetMm: 4.2 })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg?.body).toContain('4.2')
  })

  it('aggiunge un avvertimento quando la qualità immagine è marginal', () => {
    const report = makeReport({ verdict: 'misaligned', maxOffsetMm: 3, imageQuality: 'marginal' })
    const msg = selectOcrBannerMessage(report, 5)
    const senzaAvviso = makeReport({ verdict: 'misaligned', maxOffsetMm: 3, imageQuality: 'good' })
    const msgSenzaAvviso = selectOcrBannerMessage(senzaAvviso, 5)
    expect(msg?.body.length).toBeGreaterThan(msgSenzaAvviso?.body.length ?? 0)
  })
})

// ─── textQuality poor / suspect ─────────────────────────────────────────────────

describe('selectOcrBannerMessage — qualità del testo scadente o sospetta', () => {
  it('textQuality poor è warning con pulsante di rifacimento OCR', () => {
    const report = makeReport({
      textQuality: 'poor',
      textQualityReasons: ['text-too-short'] as TextQualityReason[],
    })
    const msg = selectOcrBannerMessage(report, 5)
    expect(msg?.severity).toBe('warning')
    expect(msg?.showRedoButton).toBe(true)
  })

  it('textQuality suspect è warning con pulsante di rifacimento OCR e testo più cauto', () => {
    const reportSuspect = makeReport({
      textQuality: 'suspect',
      textQualityReasons: ['low-function-word-ratio'] as TextQualityReason[],
    })
    const reportPoor = makeReport({ textQuality: 'poor' })
    const msgSuspect = selectOcrBannerMessage(reportSuspect, 5)
    const msgPoor = selectOcrBannerMessage(reportPoor, 5)
    expect(msgSuspect?.severity).toBe('warning')
    expect(msgSuspect?.showRedoButton).toBe(true)
    // Testi diversi: il messaggio "suspect" non deve essere identico a "poor"
    expect(msgSuspect?.body).not.toBe(msgPoor?.body)
  })
})

// ─── Stima dei minuti ───────────────────────────────────────────────────────────

describe('selectOcrBannerMessage — stima del tempo di rifacimento', () => {
  it('la stima cresce con il numero di pagine', () => {
    const report = makeReport({ verdict: 'misaligned', maxOffsetMm: 3 })
    const msgPoche = selectOcrBannerMessage(report, 1)
    const msgTante = selectOcrBannerMessage(report, 120)
    expect(msgPoche?.estimatedMinutes).not.toBeNull()
    expect(msgTante?.estimatedMinutes).not.toBeNull()
    expect(msgTante!.estimatedMinutes!).toBeGreaterThan(msgPoche!.estimatedMinutes!)
  })

  it('la stima minima è di 1 minuto anche per un documento di una pagina', () => {
    const report = makeReport({ textQuality: 'poor' })
    const msg = selectOcrBannerMessage(report, 1)
    expect(msg?.estimatedMinutes).toBeGreaterThanOrEqual(1)
  })
})

// ─── Nessun contenuto documentale nei messaggi ─────────────────────────────────

describe('selectOcrBannerMessage — privacy dei messaggi', () => {
  it('nessuno dei messaggi generati contiene testo di documento (solo numeri e frasi fisse)', () => {
    const reports = [
      makeReport({ imageQuality: 'poor' }),
      makeReport({ verdict: 'misaligned', maxOffsetMm: 3 }),
      makeReport({ textQuality: 'poor' }),
      makeReport({ textQuality: 'suspect' }),
    ]
    for (const report of reports) {
      const msg = selectOcrBannerMessage(report, 5)
      expect(msg).not.toBeNull()
      // I messaggi sono costruiti solo da costanti + numeri: nessun campo del
      // report che potrebbe contenere testo estratto dal documento (non esiste
      // nel tipo OcrLayerReport, ma verifichiamo comunque l'assenza di segnali
      // di interpolazione di stringhe arbitrarie, es. placeholder non sostituiti).
      expect(msg?.body).not.toMatch(/undefined|\[object|NaN/)
      expect(msg?.title).not.toMatch(/undefined|\[object|NaN/)
    }
  })
})
