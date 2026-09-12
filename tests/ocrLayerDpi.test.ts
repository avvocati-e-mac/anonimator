import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { degrees, PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { analyzePdfQuality } from '../src/main/services/ocrLayerCheck'

async function writeImageOnlyPdf(filePath: string, dpi: number): Promise<void> {
  const pageWidth = 595.224
  const pageHeight = 841.896
  const width = Math.round((pageWidth / 72) * dpi)
  const height = Math.round((pageHeight / 72) * dpi)
  const pixels = Buffer.alloc(width * height, 255)
  for (let y = 80; y < Math.min(height, 130); y++) {
    for (let x = 80; x < Math.min(width, 700); x++) {
      if (x % 12 < 7) pixels[y * width + x] = 0
    }
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer()
  const document = await PDFDocument.create()
  const image = await document.embedPng(png)
  document.addPage([pageWidth, pageHeight]).drawImage(image, {
    x: 0, y: 0, width: pageWidth, height: pageHeight,
  })
  await writeFile(filePath, await document.save())
}

describe('DPI nativo di PDF image-only', () => {
  it.each([150, 300])('misura una scansione a %i DPI anche senza layer testo', async (dpi) => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-layer-dpi-'))
    const filePath = join(dir, `synthetic-${dpi}.pdf`)
    try {
      await writeImageOnlyPdf(filePath, dpi)
      const { report } = await analyzePdfQuality(filePath)
      expect(report.layerKind).toBe('scan-no-text')
      expect(report.imageMetrics.nativeDpi).toBeCloseTo(dpi, 0)
      expect(report.imageQualityReasons.includes('low-native-dpi')).toBe(dpi === 150)
      expect(report.suggestedOcrDpi).toBe(dpi === 150 ? 200 : 300)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('misura correttamente un raster rettangolare ruotato di 90 gradi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-layer-dpi-rotated-'))
    const filePath = join(dir, 'synthetic-rotated.pdf')
    const width = 1200
    const height = 600
    try {
      const png = await sharp(Buffer.alloc(width * height, 255), {
        raw: { width, height, channels: 1 },
      }).png().toBuffer()
      const document = await PDFDocument.create()
      const image = await document.embedPng(png)
      document.addPage([300, 600]).drawImage(image, {
        x: 300, y: 0, width: 600, height: 300, rotate: degrees(90),
      })
      await writeFile(filePath, await document.save())
      const { report } = await analyzePdfQuality(filePath)
      expect(report.layerKind).toBe('scan-no-text')
      expect(report.imageMetrics.nativeDpi).toBe(144)
      expect(report.imageQualityReasons).toContain('very-low-native-dpi')
      expect(report.suggestedOcrDpi).toBe(200)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
