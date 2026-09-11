import { describe, expect, it } from 'vitest'
import {
  BITONAL_TUNING,
  BitonalCodecError,
  analyzeBitonalEligibility,
  bitonalIneligibleReason,
  packBitonalMsb,
  tightRgbRaster,
  type BitonalMetrics,
} from '../src/main/services/bitonalCodec'

function grayRaster(width: number, height: number, value = 255): Uint8Array {
  const rgb = new Uint8Array(width * height * 3)
  for (let index = 0; index < width * height; index++) {
    rgb[index * 3] = value
    rgb[index * 3 + 1] = value
    rgb[index * 3 + 2] = value
  }
  return rgb
}

function setPixel(rgb: Uint8Array, width: number, x: number, y: number, value: readonly [number, number, number]): void {
  const offset = (y * width + x) * 3
  rgb[offset] = value[0]
  rgb[offset + 1] = value[1]
  rgb[offset + 2] = value[2]
}

describe('selettore bitonale conservativo', () => {
  it('considera inclusivi i bordi sicuri e rifiuta il primo valore oltre soglia', () => {
    const safe: BitonalMetrics = {
      threshold: 127,
      separability: BITONAL_TUNING.SEPARABILITY_MIN,
      ambiguousRatio: BITONAL_TUNING.AMBIGUOUS_RATIO_MAX,
      inkFraction: BITONAL_TUNING.INK_FRACTION_MIN,
      coloredRatio: 0,
      maxColoredPixelsPerBlock: 0,
      maxAmbiguousPixelsPerBlock: BITONAL_TUNING.AMBIGUOUS_BLOCK_PIXELS_MAX,
      absoluteMidtoneRatio: 0,
    }
    expect(bitonalIneligibleReason(safe)).toBeNull()
    expect(bitonalIneligibleReason({ ...safe, separability: safe.separability - Number.EPSILON }))
      .toBe('low-separability')
    expect(bitonalIneligibleReason({ ...safe, ambiguousRatio: safe.ambiguousRatio + Number.EPSILON }))
      .toBe('ambiguous-tones')
    expect(bitonalIneligibleReason({ ...safe, inkFraction: safe.inkFraction - Number.EPSILON }))
      .toBe('ink-fraction')
    expect(bitonalIneligibleReason({ ...safe, inkFraction: BITONAL_TUNING.INK_FRACTION_MAX + Number.EPSILON }))
      .toBe('ink-fraction')
    expect(bitonalIneligibleReason({ ...safe, coloredRatio: Number.EPSILON }))
      .toBe('colored-content')
    expect(bitonalIneligibleReason({ ...safe, absoluteMidtoneRatio: Number.EPSILON }))
      .toBe('ambiguous-tones')
    expect(bitonalIneligibleReason({
      ...safe,
      maxAmbiguousPixelsPerBlock: safe.maxAmbiguousPixelsPerBlock + 1,
    })).toBe('ambiguous-tones')
  })

  it('ammette una pagina sintetica strettamente bianca e nera', () => {
    const width = 100
    const height = 100
    const rgb = grayRaster(width, height)
    for (let y = 20; y < 30; y++) {
      for (let x = 10; x < 90; x++) setPixel(rgb, width, x, y, [0, 0, 0])
    }
    const result = analyzeBitonalEligibility(rgb, width, height)
    expect(result.eligible).toBe(true)
    expect(result.metrics.separability).toBeGreaterThanOrEqual(BITONAL_TUNING.SEPARABILITY_MIN)
    expect(result.metrics.inkFraction).toBeCloseTo(0.08)
  })

  it('rifiuta un piccolo timbro colorato coerente anche se occupa poca pagina', () => {
    const width = 200
    const height = 100
    const rgb = grayRaster(width, height)
    for (let y = 20; y < 30; y++) {
      for (let x = 10; x < 110; x++) setPixel(rgb, width, x, y, [0, 0, 0])
    }
    for (let y = 60; y < 64; y++) {
      for (let x = 160; x < 164; x++) setPixel(rgb, width, x, y, [0, 80, 220])
    }
    expect(analyzeBitonalEligibility(rgb, width, height)).toMatchObject({
      eligible: false,
      reason: 'colored-content',
    })
  })

  it('rifiuta nove pixel cromatici distribuiti tre per blocco con ratio 0,00009', () => {
    const width = 1000
    const height = 100
    const rgb = grayRaster(width, height)
    for (let x = 0; x < 500; x++) setPixel(rgb, width, x, 20, [0, 0, 0])
    for (const startX of [400, 416, 432]) {
      for (let x = startX; x < startX + 3; x++) setPixel(rgb, width, x, 60, [0, 80, 220])
    }
    const result = analyzeBitonalEligibility(rgb, width, height)
    expect(result.metrics.coloredRatio).toBeCloseTo(0.00009, 8)
    expect(result.metrics.maxColoredPixelsPerBlock).toBe(3)
    expect(result).toMatchObject({ eligible: false, reason: 'colored-content' })
  })

  it('ammette i bordi assoluti 32/223 ma rifiuta il primo midtone interno', () => {
    const width = 100
    const height = 100
    const boundary = grayRaster(width, height, BITONAL_TUNING.LIGHT_LUMA_MIN)
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(boundary, width, x, y, [
          BITONAL_TUNING.DARK_LUMA_MAX,
          BITONAL_TUNING.DARK_LUMA_MAX,
          BITONAL_TUNING.DARK_LUMA_MAX,
        ])
      }
    }
    expect(analyzeBitonalEligibility(boundary, width, height).eligible).toBe(true)

    const aboveDark = Uint8Array.from(boundary)
    setPixel(aboveDark, width, 50, 50, [33, 33, 33])
    expect(analyzeBitonalEligibility(aboveDark, width, height)).toMatchObject({
      eligible: false, reason: 'ambiguous-tones',
    })

    const belowLight = Uint8Array.from(boundary)
    setPixel(belowLight, width, 50, 50, [222, 222, 222])
    expect(analyzeBitonalEligibility(belowLight, width, height)).toMatchObject({
      eligible: false, reason: 'ambiguous-tones',
    })
  })

  it('rifiuta una fotografia in gradiente per toni non nettamente separati', () => {
    const width = 256
    const height = 32
    const rgb = grayRaster(width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) setPixel(rgb, width, x, y, [x, x, x])
    }
    const result = analyzeBitonalEligibility(rgb, width, height)
    expect(result.eligible).toBe(false)
    if (result.eligible) throw new Error('Il gradiente non deve essere idoneo')
    expect(['low-separability', 'ambiguous-tones']).toContain(result.reason)
  })

  it('rifiuta una pagina con inchiostro sotto la soglia minima', () => {
    const width = 100
    const height = 100
    const rgb = grayRaster(width, height)
    setPixel(rgb, width, 50, 50, [0, 0, 0])
    expect(analyzeBitonalEligibility(rgb, width, height)).toMatchObject({
      eligible: false,
      reason: 'ink-fraction',
    })
  })

  it('vieta un tratto sbiadito localizzato anche sotto la soglia ambigua globale', () => {
    const width = 1000
    const height = 100
    const rgb = grayRaster(width, height)
    for (let x = 0; x < 500; x++) setPixel(rgb, width, x, 20, [0, 0, 0])
    for (let x = 400; x < 404; x++) setPixel(rgb, width, x, 60, [180, 180, 180])
    const result = analyzeBitonalEligibility(rgb, width, height)
    expect(result.metrics.ambiguousRatio).toBeLessThanOrEqual(BITONAL_TUNING.AMBIGUOUS_RATIO_MAX)
    expect(result.metrics.coloredRatio).toBe(0)
    expect(result).toMatchObject({ eligible: false, reason: 'ambiguous-tones' })
  })
})

describe('layout raster RGB', () => {
  it('rimuove in modo deterministico il padding di riga', () => {
    const padded = new Uint8Array([
      1, 2, 3, 4, 5, 6, 99, 99,
      7, 8, 9, 10, 11, 12, 88, 88,
    ])
    expect([...tightRgbRaster(padded, 2, 2, 8)]).toEqual([
      1, 2, 3, 4, 5, 6,
      7, 8, 9, 10, 11, 12,
    ])
  })

  it('rifiuta stride corto, buffer troncato o byte extra non dichiarati', () => {
    expect(() => tightRgbRaster(new Uint8Array(12), 2, 2, 5)).toThrow(BitonalCodecError)
    expect(() => tightRgbRaster(new Uint8Array(15), 2, 2, 8)).toThrow(BitonalCodecError)
    expect(() => tightRgbRaster(new Uint8Array(17), 2, 2, 8)).toThrow(BitonalCodecError)
  })
})

describe('packer 1-bit MSB-first', () => {
  it('usa 0 per il nero, 1 per il bianco e lascia bianchi i bit di padding', () => {
    const width = 9
    const height = 2
    const rgb = grayRaster(width, height)
    setPixel(rgb, width, 0, 0, [0, 0, 0])
    setPixel(rgb, width, 7, 0, [0, 0, 0])
    setPixel(rgb, width, 8, 0, [0, 0, 0])
    expect([...packBitonalMsb(rgb, width, height, 127)]).toEqual([
      0x7e, 0x7f,
      0xff, 0xff,
    ])
  })

  it('rifiuta buffer e soglie non validi con codice fisso', () => {
    expect(() => packBitonalMsb(new Uint8Array(2), 1, 1, 127)).toThrow(BitonalCodecError)
    expect(() => packBitonalMsb(grayRaster(1, 1), 1, 1, 256)).toThrow(BitonalCodecError)
  })
})
