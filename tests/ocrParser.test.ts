import { describe, it, expect, vi } from 'vitest'

// Mock electron — non c'è finestra Electron in vitest (stesso pattern di pdfParser.test.ts).
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/test-userdata' }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// nerService è un modulo pesante (Transformers.js, LLM, sessionManager...): ocrParser
// ne importa solo getTessdataPath, quindi lo si mocka per non trascinarsi dietro tutto
// il grafo di dipendenze in un test che deve restare rapido e deterministico.
vi.mock('../src/main/services/nerService', () => ({
  getTessdataPath: vi.fn(() => '/tmp/test-tessdata')
}))

import {
  OCR_CONFIDENCE_THRESHOLD,
  buildImageLowConfidenceWarning,
  buildOcrRenderMatrix,
  buildPdfLowConfidenceWarning,
  isLowConfidence,
  resolveRenderDpi
} from '../src/main/parsers/ocrParser'
import {
  OCR_RENDER_DPI_DEFAULT,
  OCR_RENDER_DPI_MAX,
  OCR_RENDER_DPI_MIN,
  dpiToScale,
  resolveOcrDpi
} from '../src/main/services/ocrRenderConfig'

// ocrParser ha bisogno di Tesseract e di ita.traineddata per i percorsi end-to-end
// (parseImage, parsePdfWithOcr): test lenti e fragili, esclusi qui di proposito.
// Si testano solo le parti pure e deterministiche: risoluzione DPI, composizione
// della matrice di deskew, soglia di confidenza e messaggi di warning.

describe('resolveRenderDpi', () => {
  it('delega a resolveOcrDpi — nessuna costante locale', () => {
    expect(resolveRenderDpi(undefined)).toBe(OCR_RENDER_DPI_DEFAULT)
    expect(resolveRenderDpi(undefined)).toBe(resolveOcrDpi(undefined))
  })

  it('rispetta il clamp [200, 400] del contratto condiviso', () => {
    expect(resolveRenderDpi(1200)).toBe(OCR_RENDER_DPI_MAX)
    expect(resolveRenderDpi(50)).toBe(OCR_RENDER_DPI_MIN)
    expect(resolveRenderDpi(250)).toBe(250)
  })

  it('coincide con resolveOcrDpi su un campione di valori arbitrari', () => {
    for (const v of [null, undefined, 72, 150, 200, 300, 400, 600, 1000]) {
      expect(resolveRenderDpi(v ?? undefined)).toBe(resolveOcrDpi(v))
    }
  })
})

describe('buildOcrRenderMatrix', () => {
  const dpi = 300
  const s = dpiToScale(dpi)

  it('senza skewDeg produce solo la matrice di scala (nessuna rotazione)', () => {
    expect(buildOcrRenderMatrix(dpi)).toEqual([s, 0, 0, s, 0, 0])
  })

  it('sotto la soglia di 0,5° non ruota', () => {
    expect(buildOcrRenderMatrix(dpi, 0)).toEqual([s, 0, 0, s, 0, 0])
    expect(buildOcrRenderMatrix(dpi, 0.3)).toEqual([s, 0, 0, s, 0, 0])
    expect(buildOcrRenderMatrix(dpi, -0.49)).toEqual([s, 0, 0, s, 0, 0])
  })

  it('esattamente a 0,5° la soglia scatta (>=, non solo >)', () => {
    const m = buildOcrRenderMatrix(dpi, 0.5)
    expect(m).not.toEqual([s, 0, 0, s, 0, 0])
  })

  it('angoli non finiti sono trattati come nessuna rotazione', () => {
    expect(buildOcrRenderMatrix(dpi, Number.NaN)).toEqual([s, 0, 0, s, 0, 0])
  })

  it('per un angolo noto compone scala e contro-rotazione (-skewDeg)', () => {
    const skewDeg = 4
    const rad = (-skewDeg * Math.PI) / 180
    const c = Math.cos(rad)
    const sn = Math.sin(rad)

    const m = buildOcrRenderMatrix(dpi, skewDeg)

    expect(m[0]).toBeCloseTo(s * c, 10)
    expect(m[1]).toBeCloseTo(s * sn, 10)
    expect(m[2]).toBeCloseTo(-s * sn, 10)
    expect(m[3]).toBeCloseTo(s * c, 10)
    expect(m[4]).toBe(0)
    expect(m[5]).toBe(0)
  })

  it("un'inclinazione negativa ruota nel verso opposto", () => {
    const skewDeg = -3
    const rad = (-skewDeg * Math.PI) / 180
    const m = buildOcrRenderMatrix(dpi, skewDeg)

    expect(m[0]).toBeCloseTo(s * Math.cos(rad), 10)
    expect(m[1]).toBeCloseTo(s * Math.sin(rad), 10)
    // Segno opposto rispetto al caso skewDeg positivo di pari modulo.
    const opposite = buildOcrRenderMatrix(dpi, -skewDeg)
    expect(m[1]).toBeCloseTo(-opposite[1], 10)
  })

  it('la rotazione preserva il determinante s² (nessuna distorsione di scala)', () => {
    const m = buildOcrRenderMatrix(dpi, 3)
    const det = m[0] * m[3] - m[1] * m[2]
    expect(det).toBeCloseTo(s * s, 8)
  })
})

describe('soglia di confidenza OCR e messaggi di warning', () => {
  it('isLowConfidence rispetta la soglia (< e non <=)', () => {
    expect(isLowConfidence(OCR_CONFIDENCE_THRESHOLD - 1)).toBe(true)
    expect(isLowConfidence(OCR_CONFIDENCE_THRESHOLD)).toBe(false)
    expect(isLowConfidence(100)).toBe(false)
    expect(isLowConfidence(0)).toBe(true)
  })

  it('messaggio di warning per una singola immagine', () => {
    expect(buildImageLowConfidenceWarning(42.6)).toBe(
      'Qualità OCR bassa (43%). Verificare manualmente le entità rilevate.'
    )
  })

  it('messaggio di warning aggregato per un PDF multipagina', () => {
    const msg = buildPdfLowConfidenceWarning(3)
    expect(msg).toContain('3 pagina/e')
    expect(msg).toContain(`< ${OCR_CONFIDENCE_THRESHOLD}%`)
    expect(msg).toContain('Verificare manualmente le entità rilevate.')
  })
})
