import type { AffineMatrix } from './geometry'

export const MAX_PAGE_PIXELS = 50_000_000
const MUPDF_ROUND_TOLERANCE = 0.001

export interface ProjectedPixmap {
  x: number
  y: number
  width: number
  height: number
  pixels: number
}

export class RenderBudgetError extends Error {
  readonly code = 'resource-limit'

  constructor() {
    super('La pagina supera il limite sicuro di 50 milioni di pixel.')
    this.name = 'RenderBudgetError'
  }
}

function fail(): never {
  throw new RenderBudgetError()
}

function transformF32(x: number, y: number, matrix: AffineMatrix): readonly [number, number] {
  const [rawA, rawB, rawC, rawD, rawE, rawF] = matrix
  const a = Math.fround(rawA)
  const b = Math.fround(rawB)
  const c = Math.fround(rawC)
  const d = Math.fround(rawD)
  const e = Math.fround(rawE)
  const f = Math.fround(rawF)
  const px = Math.fround(x)
  const py = Math.fround(y)
  return [
    Math.fround(Math.fround(Math.fround(px * a) + Math.fround(py * c)) + e),
    Math.fround(Math.fround(Math.fround(px * b) + Math.fround(py * d)) + f),
  ]
}

/** Emula il bbox intero `fz_round_rect` usato da MuPDF prima di allocare il pixmap. */
export function estimatePixmap(
  bounds: readonly number[],
  matrix: AffineMatrix,
): ProjectedPixmap {
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || !matrix.every(Number.isFinite)) fail()
  const [x0, y0, x1, y1] = bounds.map(Math.fround)
  if (!(x1 > x0) || !(y1 > y0)) fail()

  const corners = [
    transformF32(x0, y0, matrix),
    transformF32(x1, y0, matrix),
    transformF32(x0, y1, matrix),
    transformF32(x1, y1, matrix),
  ]
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  const left = Math.floor(Math.min(...xs) + MUPDF_ROUND_TOLERANCE)
  const top = Math.floor(Math.min(...ys) + MUPDF_ROUND_TOLERANCE)
  const right = Math.ceil(Math.max(...xs) - MUPDF_ROUND_TOLERANCE)
  const bottom = Math.ceil(Math.max(...ys) - MUPDF_ROUND_TOLERANCE)
  const width = right - left
  const height = bottom - top
  if (
    !Number.isSafeInteger(left)
    || !Number.isSafeInteger(top)
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > Math.floor(Number.MAX_SAFE_INTEGER / height)
  ) fail()
  return { x: left, y: top, width, height, pixels: width * height }
}

export function assertPixelDimensions(
  width: number,
  height: number,
  maxPixels = MAX_PAGE_PIXELS,
): void {
  if (
    !Number.isSafeInteger(maxPixels)
    || maxPixels <= 0
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > Math.floor(maxPixels / height)
  ) fail()
}

export function assertPixmapBudget(
  bounds: readonly number[],
  matrix: AffineMatrix,
  maxPixels = MAX_PAGE_PIXELS,
): ProjectedPixmap {
  const projected = estimatePixmap(bounds, matrix)
  assertPixelDimensions(projected.width, projected.height, maxPixels)
  return projected
}

/** Il callback di rendering non viene invocato se il preflight fallisce. */
export function renderWithinPixelBudget<Result>(
  bounds: readonly number[],
  matrix: AffineMatrix,
  render: () => Result,
): Result {
  assertPixmapBudget(bounds, matrix)
  return render()
}
