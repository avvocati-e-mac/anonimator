import { describe, expect, it } from 'vitest'
import { resolvePdfRasterCodec } from '../src/main/services/rasterCodecConfig'

describe('resolvePdfRasterCodec', () => {
  it('traduce la scelta esplicita nella modalità Main-only forzata', () => {
    expect(resolvePdfRasterCodec('force-bitonal')).toBe('bitonal-force')
  })

  it('mantiene JPEG per default e per la scelta di preservare i colori', () => {
    expect(resolvePdfRasterCodec(undefined)).toBeUndefined()
    expect(resolvePdfRasterCodec('preserve-color')).toBeUndefined()
  })
})
