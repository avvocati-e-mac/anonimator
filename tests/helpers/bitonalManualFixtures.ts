export const LARGE_BITONAL_FIXTURE_WIDTH = 1400
export const LARGE_BITONAL_FIXTURE_HEIGHT = 1800

/** Fixture bianco/nero grande condivisa dal gate automatico e dal manuale. */
export function largeMonochromePage(): Buffer {
  const width = LARGE_BITONAL_FIXTURE_WIDTH
  const height = LARGE_BITONAL_FIXTURE_HEIGHT
  const rgb = Buffer.alloc(width * height * 3, 255)
  for (let row = 0; row < 54; row++) {
    const y0 = 24 + row * 30
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = 45; x < width - 45; x++) {
        if ((x % 22) < 13) {
          const offset = (y * width + x) * 3
          rgb[offset] = 0
          rgb[offset + 1] = 0
          rgb[offset + 2] = 0
        }
      }
    }
  }
  return rgb
}
