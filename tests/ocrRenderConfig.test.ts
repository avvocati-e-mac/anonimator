import { describe, it, expect } from 'vitest'
import {
  resolveOcrDpi, dpiToScale,
  OCR_RENDER_DPI_DEFAULT, OCR_RENDER_DPI_MIN, OCR_RENDER_DPI_MAX
} from '../src/main/services/ocrRenderConfig'

describe('ocrRenderConfig', () => {
  it('senza DPI nativo usa il default di 300', () => {
    expect(resolveOcrDpi(null)).toBe(OCR_RENDER_DPI_DEFAULT)
    expect(resolveOcrDpi(undefined)).toBe(300)
    expect(resolveOcrDpi(Number.NaN)).toBe(300)
  })

  it('segue il DPI nativo quando è nei limiti', () => {
    expect(resolveOcrDpi(300)).toBe(300)
    expect(resolveOcrDpi(250)).toBe(250)
  })

  it('non renderizza sopra la risoluzione nativa oltre il tetto', () => {
    expect(resolveOcrDpi(600)).toBe(OCR_RENDER_DPI_MAX)
    expect(resolveOcrDpi(1200)).toBe(400)
  })

  it('alza le scansioni troppo povere fino al minimo utile', () => {
    expect(resolveOcrDpi(100)).toBe(OCR_RENDER_DPI_MIN)
    expect(resolveOcrDpi(72)).toBe(200)
  })

  it('dpiToScale è coerente con la conversione punti/pixel', () => {
    expect(dpiToScale(72)).toBe(1)
    expect(dpiToScale(300)).toBeCloseTo(4.1667, 4)
    // Un punto a 300 DPI e il ritorno indietro devono coincidere.
    const s = dpiToScale(300)
    expect((123.4 * s) / s).toBeCloseTo(123.4, 6)
  })
})
