import { describe, expect, it } from 'vitest'
import {
  GeometryError,
  invertMatrix,
  mupdfRectToPdfUserSpace,
  renderedPixelRectToMupdf,
  transformRect,
  type AffineMatrix,
  type Rect
} from '../src/main/services/geometry'

function expectRectClose(actual: Rect, expected: Rect): void {
  expect(actual.x0).toBeCloseTo(expected.x0, 10)
  expect(actual.y0).toBeCloseTo(expected.y0, 10)
  expect(actual.x1).toBeCloseTo(expected.x1, 10)
  expect(actual.y1).toBeCloseTo(expected.y1, 10)
}

describe('renderedPixelRectToMupdf', () => {
  const pageRect: Rect = { x0: 13, y0: 29, x1: 71, y1: 113 }
  const cases: Array<[string, AffineMatrix]> = [
    ['0°', [2, 0, 0, 2, 17, -31]],
    ['90°', [0, 2, -2, 0, 501, 17]],
    ['180°', [-2, 0, 0, -2, 501, 701]],
    ['270°', [0, -2, 2, 0, -31, 701]]
  ]

  it.each(cases)('inverte rendering e origine pixmap a %s', (_label, renderMatrix) => {
    const origin = { x: -37, y: 19 }
    const device = transformRect(pageRect, renderMatrix)
    const pixelRect = {
      x0: device.x0 - origin.x,
      y0: device.y0 - origin.y,
      x1: device.x1 - origin.x,
      y1: device.y1 - origin.y
    }
    expectRectClose(renderedPixelRectToMupdf(pixelRect, renderMatrix, origin), pageRect)
  })

  it('rifiuta matrici singolari e rettangoli invertiti', () => {
    expect(() => invertMatrix([1, 2, 2, 4, 0, 0])).toThrow(GeometryError)
    expect(() => renderedPixelRectToMupdf(
      { x0: 2, y0: 0, x1: 1, y1: 1 }, [1, 0, 0, 1, 0, 0], { x: 0, y: 0 }
    )).toThrow(GeometryError)
  })
})

describe('mupdfRectToPdfUserSpace', () => {
  it('usa la matrice pagina per rappresentare CropBox, UserUnit e inversione Y', () => {
    // PDF user-space -> MuPDF: UserUnit 2, CropBox (10, 20), altezza trasformata 800.
    const pageTransform: AffineMatrix = [2, 0, 0, -2, -20, 1600]
    const pdfRect: Rect = { x0: 30, y0: 100, x1: 90, y1: 140 }
    const mupdfRect = transformRect(pdfRect, pageTransform)
    expectRectClose(mupdfRectToPdfUserSpace(mupdfRect, pageTransform), pdfRect)
  })
})

