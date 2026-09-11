/**
 * Primitive geometriche pure per mantenere espliciti gli spazi di coordinate.
 *
 * Le matrici seguono la convenzione affine di MuPDF `[a, b, c, d, e, f]`:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
 */

export type AffineMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
]

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PixmapOrigin {
  /** Coordinata device-space restituita da `Pixmap.getX()`. */
  x: number
  /** Coordinata device-space restituita da `Pixmap.getY()`. */
  y: number
}

export class GeometryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeometryError'
  }
}

function assertFinite(values: readonly number[], label: string): void {
  if (!values.every(Number.isFinite)) throw new GeometryError(`${label} contains non-finite values`)
}

function assertRect(rect: Rect, label: string): void {
  assertFinite([rect.x0, rect.y0, rect.x1, rect.y1], label)
  if (rect.x1 < rect.x0 || rect.y1 < rect.y0) {
    throw new GeometryError(`${label} has inverted bounds`)
  }
}

export function transformPoint(point: Point, matrix: AffineMatrix): Point {
  assertFinite([point.x, point.y], 'point')
  assertFinite(matrix, 'matrix')
  const [a, b, c, d, e, f] = matrix
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f
  }
}

export function invertMatrix(matrix: AffineMatrix): AffineMatrix {
  assertFinite(matrix, 'matrix')
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  // Una soglia relativa evita di accettare matrici numericamente singolari anche
  // quando hanno scale molto grandi o molto piccole.
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1)
  if (Math.abs(determinant) <= Number.EPSILON * scale * scale * 16) {
    throw new GeometryError('matrix is singular')
  }

  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ]
}

/** Trasforma tutti gli angoli e restituisce il loro axis-aligned bounding box. */
export function transformRect(rect: Rect, matrix: AffineMatrix): Rect {
  assertRect(rect, 'rect')
  const corners = [
    transformPoint({ x: rect.x0, y: rect.y0 }, matrix),
    transformPoint({ x: rect.x1, y: rect.y0 }, matrix),
    transformPoint({ x: rect.x0, y: rect.y1 }, matrix),
    transformPoint({ x: rect.x1, y: rect.y1 }, matrix)
  ]
  return {
    x0: Math.min(...corners.map(({ x }) => x)),
    y0: Math.min(...corners.map(({ y }) => y)),
    x1: Math.max(...corners.map(({ x }) => x)),
    y1: Math.max(...corners.map(({ y }) => y))
  }
}

/**
 * Converte un bbox relativo ai pixel prodotti per Tesseract in coordinate pagina
 * MuPDF. Il bbox OCR parte da `(0, 0)` nell'immagine, mentre la matrice di rendering
 * produce coordinate device assolute: per questo l'origine reale della pixmap va
 * aggiunta prima di applicare la matrice inversa.
 */
export function renderedPixelRectToMupdf(
  pixelRect: Rect,
  renderMatrix: AffineMatrix,
  pixmapOrigin: PixmapOrigin
): Rect {
  assertRect(pixelRect, 'pixel rect')
  assertFinite([pixmapOrigin.x, pixmapOrigin.y], 'pixmap origin')
  const deviceRect: Rect = {
    x0: pixelRect.x0 + pixmapOrigin.x,
    y0: pixelRect.y0 + pixmapOrigin.y,
    x1: pixelRect.x1 + pixmapOrigin.x,
    y1: pixelRect.y1 + pixmapOrigin.y
  }
  return transformRect(deviceRect, invertMatrix(renderMatrix))
}

/**
 * Converte coordinate pagina MuPDF in PDF user-space.
 *
 * `PDFPage.getTransform()` descrive PDF user-space -> spazio pagina MuPDF; si usa
 * quindi la sua inversa. CropBox, UserUnit e rotazione restano proprietà della
 * matrice fornita dal documento e non vengono ricostruiti con formule manuali.
 */
export function mupdfRectToPdfUserSpace(
  mupdfRect: Rect,
  pageTransform: AffineMatrix
): Rect {
  return transformRect(mupdfRect, invertMatrix(pageTransform))
}

