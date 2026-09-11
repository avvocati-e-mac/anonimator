/**
 * Selettore e packer bitonale puri.
 *
 * Il modulo non conosce PDF, path o contenuto OCR. Riceve esclusivamente il
 * raster RGB gia' prodotto dal Main e restituisce metriche numeriche oppure un
 * bitmask 1-bit. La decisione e' intenzionalmente conservativa: in dubbio il
 * chiamante deve conservare il codec JPEG corrente.
 */

export const BITONAL_TUNING = {
  CHROMA_DELTA_MIN: 24,
  CHROMA_BLOCK_SIZE: 8,
  DARK_LUMA_MAX: 32,
  LIGHT_LUMA_MIN: 223,
  SEPARABILITY_MIN: 0.9,
  AMBIGUOUS_HALF_WIDTH: 24,
  AMBIGUOUS_RATIO_MAX: 0.01,
  AMBIGUOUS_BLOCK_PIXELS_MAX: 3,
  INK_FRACTION_MIN: 0.002,
  INK_FRACTION_MAX: 0.35,
} as const

export type BitonalIneligibleReason =
  | 'colored-content'
  | 'low-separability'
  | 'ambiguous-tones'
  | 'ink-fraction'

export interface BitonalMetrics {
  threshold: number
  separability: number
  ambiguousRatio: number
  inkFraction: number
  coloredRatio: number
  maxColoredPixelsPerBlock: number
  maxAmbiguousPixelsPerBlock: number
  absoluteMidtoneRatio: number
}

export type BitonalEligibility =
  | { eligible: true; metrics: BitonalMetrics }
  | { eligible: false; reason: BitonalIneligibleReason; metrics: BitonalMetrics }

export class BitonalCodecError extends Error {
  readonly code = 'validation-failed'

  constructor(message: string) {
    super(message)
    this.name = 'BitonalCodecError'
  }
}

type RgbBytes = Uint8Array | Uint8ClampedArray

/** Decisione pura separata dalla misura, per bloccare esattamente i bordi. */
export function bitonalIneligibleReason(metrics: BitonalMetrics): BitonalIneligibleReason | null {
  if (metrics.coloredRatio > 0) return 'colored-content'
  if (metrics.absoluteMidtoneRatio > 0) return 'ambiguous-tones'
  if (metrics.separability < BITONAL_TUNING.SEPARABILITY_MIN) return 'low-separability'
  if (metrics.ambiguousRatio > BITONAL_TUNING.AMBIGUOUS_RATIO_MAX) return 'ambiguous-tones'
  if (metrics.maxAmbiguousPixelsPerBlock > BITONAL_TUNING.AMBIGUOUS_BLOCK_PIXELS_MAX) {
    return 'ambiguous-tones'
  }
  if (metrics.inkFraction < BITONAL_TUNING.INK_FRACTION_MIN
    || metrics.inkFraction > BITONAL_TUNING.INK_FRACTION_MAX) {
    return 'ink-fraction'
  }
  return null
}

/**
 * Verifica la geometria della pixmap DeviceRGB e rimuove soltanto il padding
 * di riga dichiarato. Byte ulteriori o stride troppo corto sono un errore.
 */
export function tightRgbRaster(
  rgb: RgbBytes,
  width: number,
  height: number,
  stride: number,
): Uint8Array {
  const pixels = assertRaster(rgb, width, height)
  const rowBytes = width * 3
  if (!Number.isSafeInteger(stride) || stride < rowBytes || rgb.byteLength !== stride * height) {
    throw new BitonalCodecError('Layout raster RGB non valido.')
  }
  if (stride === rowBytes) return Uint8Array.from(rgb)
  const tight = new Uint8Array(pixels * 3)
  for (let y = 0; y < height; y++) {
    tight.set(rgb.subarray(y * stride, y * stride + rowBytes), y * rowBytes)
  }
  return tight
}

function assertRaster(rgb: RgbBytes, width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new BitonalCodecError('Dimensioni raster bitonale non valide.')
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > Math.floor(Number.MAX_SAFE_INTEGER / 3)
    || rgb.byteLength < pixels * 3) {
    throw new BitonalCodecError('Buffer raster bitonale incompleto.')
  }
  return pixels
}

/** Luma intera Rec. 601, stabile su tutte le piattaforme. */
function luma(rgb: RgbBytes, offset: number): number {
  return (77 * rgb[offset] + 150 * rgb[offset + 1] + 29 * rgb[offset + 2] + 128) >> 8
}

interface OtsuClasses {
  threshold: number
  midpoint: number
  separability: number
}

function otsuClasses(histogram: Uint32Array, total: number): OtsuClasses {
  let sumAll = 0
  for (let value = 0; value < 256; value++) sumAll += value * histogram[value]
  const mean = sumAll / total
  let totalVariance = 0
  for (let value = 0; value < 256; value++) {
    totalVariance += histogram[value] * (value - mean) * (value - mean)
  }
  totalVariance /= total
  if (!(totalVariance > 0)) return { threshold: 127, midpoint: 127, separability: 0 }

  let darkWeight = 0
  let darkSum = 0
  let bestBetween = -1
  let threshold = 0
  let bestDarkWeight = 0
  let bestDarkSum = 0
  for (let value = 0; value < 256; value++) {
    darkWeight += histogram[value]
    darkSum += value * histogram[value]
    if (darkWeight === 0) continue
    const lightWeight = total - darkWeight
    if (lightWeight === 0) break
    const darkMean = darkSum / darkWeight
    const lightMean = (sumAll - darkSum) / lightWeight
    const between = (darkWeight / total) * (lightWeight / total)
      * (darkMean - lightMean) * (darkMean - lightMean)
    if (between > bestBetween) {
      bestBetween = between
      threshold = value
      bestDarkWeight = darkWeight
      bestDarkSum = darkSum
    }
  }

  if (!(bestBetween >= 0) || bestDarkWeight <= 0 || bestDarkWeight >= total) {
    return { threshold: 127, midpoint: 127, separability: 0 }
  }
  const darkMean = bestDarkSum / bestDarkWeight
  const lightMean = (sumAll - bestDarkSum) / (total - bestDarkWeight)
  return {
    threshold,
    midpoint: Math.round((darkMean + lightMean) / 2),
    separability: Math.min(1, bestBetween / totalVariance),
  }
}

export function analyzeBitonalEligibility(
  rgb: Uint8Array,
  width: number,
  height: number,
): BitonalEligibility {
  const pixels = assertRaster(rgb, width, height)
  const histogram = new Uint32Array(256)
  const blockCols = Math.ceil(width / BITONAL_TUNING.CHROMA_BLOCK_SIZE)
  const blockCounts = new Uint8Array(blockCols * Math.ceil(height / BITONAL_TUNING.CHROMA_BLOCK_SIZE))
  let coloredPixels = 0
  let maxColoredPixelsPerBlock = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3
      const red = rgb[offset]
      const green = rgb[offset + 1]
      const blue = rgb[offset + 2]
      histogram[luma(rgb, offset)]++
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > BITONAL_TUNING.CHROMA_DELTA_MIN) {
        coloredPixels++
        const block = Math.floor(y / BITONAL_TUNING.CHROMA_BLOCK_SIZE) * blockCols
          + Math.floor(x / BITONAL_TUNING.CHROMA_BLOCK_SIZE)
        if (blockCounts[block] < 255) blockCounts[block]++
        maxColoredPixelsPerBlock = Math.max(maxColoredPixelsPerBlock, blockCounts[block])
      }
    }
  }

  const classes = otsuClasses(histogram, pixels)
  const threshold = classes.midpoint
  let ambiguousPixels = 0
  let inkPixels = 0
  let absoluteMidtonePixels = 0
  for (let value = 0; value < 256; value++) {
    const count = histogram[value]
    if (value <= threshold) inkPixels += count
    if (Math.abs(value - threshold) <= BITONAL_TUNING.AMBIGUOUS_HALF_WIDTH) ambiguousPixels += count
    if (value > BITONAL_TUNING.DARK_LUMA_MAX && value < BITONAL_TUNING.LIGHT_LUMA_MIN) {
      absoluteMidtonePixels += count
    }
  }
  const ambiguousBlockCounts = new Uint8Array(blockCounts.length)
  let maxAmbiguousPixelsPerBlock = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3
      if (Math.abs(luma(rgb, offset) - threshold) > BITONAL_TUNING.AMBIGUOUS_HALF_WIDTH) continue
      const block = Math.floor(y / BITONAL_TUNING.CHROMA_BLOCK_SIZE) * blockCols
        + Math.floor(x / BITONAL_TUNING.CHROMA_BLOCK_SIZE)
      if (ambiguousBlockCounts[block] < 255) ambiguousBlockCounts[block]++
      maxAmbiguousPixelsPerBlock = Math.max(maxAmbiguousPixelsPerBlock, ambiguousBlockCounts[block])
    }
  }

  const metrics: BitonalMetrics = {
    threshold,
    separability: classes.separability,
    ambiguousRatio: ambiguousPixels / pixels,
    inkFraction: inkPixels / pixels,
    coloredRatio: coloredPixels / pixels,
    maxColoredPixelsPerBlock,
    maxAmbiguousPixelsPerBlock,
    absoluteMidtoneRatio: absoluteMidtonePixels / pixels,
  }
  const reason = bitonalIneligibleReason(metrics)
  if (reason) return { eligible: false, reason, metrics }
  return { eligible: true, metrics }
}

/**
 * Converte RGB in righe 1-bit MSB-first. 0 = nero, 1 = bianco; i bit di
 * padding a destra sono bianchi, anche se Width impedisce al lettore PDF di
 * visualizzarli.
 */
export function packBitonalMsb(
  rgb: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  assertRaster(rgb, width, height)
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new BitonalCodecError('Soglia bitonale non valida.')
  }
  const stride = Math.ceil(width / 8)
  const packed = new Uint8Array(stride * height)
  packed.fill(0xff)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3
      if (luma(rgb, offset) <= threshold) {
        packed[y * stride + Math.floor(x / 8)] &= ~(0x80 >> (x % 8))
      }
    }
  }
  return packed
}
