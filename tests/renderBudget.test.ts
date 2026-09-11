import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PAGE_PIXELS,
  RenderBudgetError,
  assertPixelDimensions,
  assertPixmapBudget,
  estimatePixmap,
  renderWithinPixelBudget,
} from '../src/main/services/renderBudget'
import type { AffineMatrix } from '../src/main/services/geometry'

const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0]

describe('preflight del budget pixmap', () => {
  it('proietta un A4 a 400 DPI entro il limite', () => {
    const scale = 400 / 72
    const result = assertPixmapBudget([0, 0, 595, 842], [scale, 0, 0, scale, 0, 0])
    expect(result).toMatchObject({ x: 0, y: 0, width: 3306, height: 4678 })
    expect(result.pixels).toBeLessThan(MAX_PAGE_PIXELS)
  })

  it('accetta il limite esatto e rifiuta un solo pixel oltre', () => {
    expect(() => assertPixelDimensions(10_000, 5_000)).not.toThrow()
    expect(() => assertPixelDimensions(10_000, 5_001)).toThrow(RenderBudgetError)
  })

  it('considera l’AABB completa di uno skew', () => {
    const scale = 400 / 72
    const radians = (-3 * Math.PI) / 180
    const skewed: AffineMatrix = [
      scale * Math.cos(radians),
      scale * Math.sin(radians),
      -scale * Math.sin(radians),
      scale * Math.cos(radians),
      0,
      0,
    ]
    expect(() => assertPixmapBudget([0, 0, 1200, 1300], [scale, 0, 0, scale, 0, 0])).not.toThrow()
    expect(() => assertPixmapBudget([0, 0, 1200, 1300], skewed)).toThrow(RenderBudgetError)
  })

  it('gestisce rotazione, traslazione e origine negativa', () => {
    expect(estimatePixmap([-10, -20, 90, 180], [0, 2, -2, 0, 50, 70])).toEqual({
      x: -310,
      y: 50,
      width: 400,
      height: 200,
      pixels: 80_000,
    })
  })

  it.each([
    [[0, 0, 0, 10], IDENTITY],
    [[0, 0, 10, Number.NaN], IDENTITY],
    [[0, 0, 10, 10], [1, 0, 0, Number.POSITIVE_INFINITY, 0, 0]],
  ])('rifiuta bounds o matrici non validi', (bounds, matrix) => {
    expect(() => estimatePixmap(bounds, matrix as AffineMatrix)).toThrow(RenderBudgetError)
  })

  it('non invoca il renderer quando il budget è superato', () => {
    const render = vi.fn()
    expect(() => renderWithinPixelBudget([0, 0, 10_000, 5_001], IDENTITY, render))
      .toThrow(RenderBudgetError)
    expect(render).not.toHaveBeenCalled()
  })
})
