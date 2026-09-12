import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFContext, PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import type { DetectedEntity } from '../src/shared/types'
import type { PdfPageQualityOutcome } from '../src/main/services/ocrLayerCheck'
import {
  LARGE_BITONAL_FIXTURE_HEIGHT,
  LARGE_BITONAL_FIXTURE_WIDTH,
  largeMonochromePage,
} from './helpers/bitonalManualFixtures'

const bitonalFailures = vi.hoisted(() => ({ selector: false, pack: false }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() },
}))

vi.mock('../src/main/services/bitonalCodec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/services/bitonalCodec')>()
  return {
    ...actual,
    analyzeBitonalEligibility(...args: Parameters<typeof actual.analyzeBitonalEligibility>) {
      if (bitonalFailures.selector) throw new actual.BitonalCodecError('Errore selector sintetico.')
      return actual.analyzeBitonalEligibility(...args)
    },
    packBitonalMsb(...args: Parameters<typeof actual.packBitonalMsb>) {
      if (bitonalFailures.pack) throw new actual.BitonalCodecError('Errore packer sintetico.')
      return actual.packBitonalMsb(...args)
    },
  }
})

import {
  enforceRasterEncodingPageCount,
  generateImagePdfSafe,
  generatePdfSafe,
} from '../src/main/outputGenerators/pdfSafeGenerator'
import { buildImagePixelMatrix } from '../src/main/parsers/ocrParser'
import { ocrArtifactCache } from '../src/main/services/ocrArtifactCache'

const ALIGNED_FIXTURE = join(__dirname, 'corpus-ocr', 'negativi', 'neg-02-allineato-flate.pdf')

function scanSafety(page: number): PdfPageQualityOutcome {
  return {
    page,
    status: 'scan-aligned',
    layerKind: 'scan-with-text',
    existingTextLayerUsable: true,
    reason: 'ok',
    metrics: {
      coverage: 1,
      lift: 2,
      lineAgreement: 1,
      scaleY: 1,
      offsetXPt: 0,
      offsetYPt: 0,
    },
    imageMetrics: null,
  }
}

function digitalSafety(page: number): PdfPageQualityOutcome {
  return {
    ...scanSafety(page),
    status: 'digital',
    layerKind: 'digital',
    existingTextLayerUsable: false,
    reason: 'not-raster-page',
  }
}

function grayPage(width: number, height: number): Buffer {
  const rgb = Buffer.alloc(width * height * 3, 255)
  for (let y = 15; y < 35; y++) {
    for (let x = 20; x < width - 20; x++) {
      if ((x % 12) < 7) {
        const offset = (y * width + x) * 3
        rgb[offset] = 0
        rgb[offset + 1] = 0
        rgb[offset + 2] = 0
      }
    }
  }
  return rgb
}

function colorPage(width: number, height: number): Buffer {
  const rgb = grayPage(width, height)
  for (let y = 55; y < 63; y++) {
    for (let x = width - 32; x < width - 24; x++) {
      const offset = (y * width + x) * 3
      rgb[offset] = 0
      rgb[offset + 1] = 80
      rgb[offset + 2] = 220
    }
  }
  return rgb
}

function photoPage(width: number, height: number): Buffer {
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.round((x / (width - 1)) * 255)
      const offset = (y * width + x) * 3
      rgb[offset] = value
      rgb[offset + 1] = value
      rgb[offset + 2] = value
    }
  }
  return rgb
}

function fadedPage(width: number, height: number): Buffer {
  const rgb = grayPage(width, height)
  for (let y = 60; y < 64; y++) {
    for (let x = 400; x < 404; x++) {
      const offset = (y * width + x) * 3
      rgb[offset] = 180
      rgb[offset + 1] = 180
      rgb[offset + 2] = 180
    }
  }
  return rgb
}

function distributedBluePage(width: number, height: number): Buffer {
  const rgb = grayPage(width, height)
  for (const startX of [400, 416, 432]) {
    for (let x = startX; x < startX + 3; x++) {
      const offset = (60 * width + x) * 3
      rgb[offset] = 0
      rgb[offset + 1] = 80
      rgb[offset + 2] = 220
    }
  }
  return rgb
}

async function writeRasterPdf(filePath: string, pages: readonly Buffer[], width: number, height: number): Promise<void> {
  const document = await PDFDocument.create()
  for (const raw of pages) {
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
    const image = await document.embedPng(png)
    document.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  }
  await writeFile(filePath, await document.save())
}

interface ImageDescription {
  bits: number
  colorSpace: string | null
}

function pageImages(document: import('mupdf').PDFDocument, pageIndex: number): ImageDescription[] {
  const page = document.loadPage(pageIndex)
  const structured = page.toStructuredText('preserve-images')
  const images: ImageDescription[] = []
  try {
    structured.walk({
      onImageBlock(_bbox, _matrix, image) {
        images.push({ bits: image.getBitsPerComponent(), colorSpace: image.getColorSpace()?.getType() ?? null })
      },
    })
    return images
  } finally {
    structured.destroy()
    page.destroy()
  }
}

function soleImageXObject(document: import('mupdf').PDFDocument, pageIndex: number): import('mupdf').PDFObject {
  const page = document.loadPage(pageIndex)
  try {
    const xObjects = page.getObject().getInheritable('Resources').get('XObject')
    const entries: import('mupdf').PDFObject[] = []
    xObjects.forEach((value) => entries.push(value))
    expect(entries).toHaveLength(1)
    return entries[0]
  } finally {
    page.destroy()
  }
}

async function expectNoOutputOrTemp(dir: string): Promise<void> {
  expect((await readdir(dir)).filter((name) => name.includes('_anonimizzato'))).toEqual([])
  expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
}

async function extractFirstImage(pdfPath: string, dir: string, name: string): Promise<{
  data: Buffer
  width: number
  height: number
  channels: number
}> {
  const prefix = join(dir, name)
  execFileSync('pdfimages', ['-png', pdfPath, prefix], { stdio: 'ignore' })
  const image = await sharp(`${prefix}-000.png`).raw().toBuffer({ resolveWithObject: true })
  return { data: image.data, width: image.info.width, height: image.info.height, channels: image.info.channels }
}

function changedFraction(
  before: Awaited<ReturnType<typeof extractFirstImage>>,
  after: Awaited<ReturnType<typeof extractFirstImage>>,
  box: readonly [number, number, number, number],
): number {
  const [x0, y0, x1, y1] = box.map(Math.round)
  let changed = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const left = before.data[(y * before.width + x) * before.channels]
      const right = after.data[(y * after.width + x) * after.channels]
      if (left !== right) changed++
    }
  }
  return changed / ((x1 - x0) * (y1 - y0))
}

describe('PDF bitonale opt-in interno', () => {
  it('richiede un descriptor codec per ogni pagina', () => {
    expect(() => enforceRasterEncodingPageCount(2, 2)).not.toThrow()
    expect(() => enforceRasterEncodingPageCount(1, 2)).toThrowError(expect.objectContaining({
      code: 'validation-failed',
    }))
  })

  it('mantiene JPEG come default anche per una scansione idonea', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-default-'))
    const input = join(dir, 'synthetic.pdf')
    await writeRasterPdf(input, [grayPage(240, 100)], 240, 100)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)],
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('crea un XObject DeviceGray BPC1 e comprime il bitmask con Flate senza perdita', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-pdf-'))
    const input = join(dir, 'synthetic.pdf')
    await writeRasterPdf(input, [grayPage(241, 101)], 241, 101)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)],
        rasterCodec: 'bitonal-auto',
      })
      const bytes = await readFile(result.outputPath)

      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(bytes))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 1, colorSpace: 'Gray' }])
        const image = soleImageXObject(output, 0)
        expect(image.isStream()).toBe(true)
        expect(image.get('Type').asName()).toBe('XObject')
        expect(image.get('Subtype').asName()).toBe('Image')
        expect(image.get('Filter').asName()).toBe('FlateDecode')
        expect(image.get('ColorSpace').asName()).toBe('DeviceGray')
        expect(image.get('BitsPerComponent').asNumber()).toBe(1)
        expect(image.get('Width').asNumber()).toBe(241)
        expect(image.get('Height').asNumber()).toBe(101)
        expect(image.get('Decode').asJS()).toEqual([0, 1])
        expect(image.readStream().length).toBe(Math.ceil(241 / 8) * 101)
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('forza una pagina a colori in un raster DeviceGray a 1 bit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-force-color-'))
    const input = join(dir, 'synthetic-color.pdf')
    await writeRasterPdf(input, [colorPage(257, 129)], 257, 129)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)],
        rasterCodec: 'bitonal-force',
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 1, colorSpace: 'Gray' }])
        const image = soleImageXObject(output, 0)
        expect(image.get('Filter').asName()).toBe('FlateDecode')
        expect(image.get('BitsPerComponent').asNumber()).toBe(1)
        expect(image.readStream().length).toBe(Math.ceil(257 / 8) * 129)
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('forza anche un PNG a colori nel PDF standalone DeviceGray a 1 bit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-force-image-'))
    const input = join(dir, 'synthetic-color.png')
    const width = 257
    const height = 129
    const token = randomUUID()
    const handle = ocrArtifactCache.stage({
      pages: [{
        page: 1,
        words: [],
        renderMatrix: buildImagePixelMatrix(),
        pixmapOrigin: { x: 0, y: 0 },
      }],
    })
    ocrArtifactCache.bind(handle, token)
    await sharp(colorPage(width, height), { raw: { width, height, channels: 3 } }).png().toFile(input)
    try {
      const result = await generateImagePdfSafe(input, [], {
        analysisToken: token,
        rasterCodec: 'bitonal-force',
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 1, colorSpace: 'Gray' }])
      } finally {
        output.destroy()
      }
    } finally {
      ocrArtifactCache.release(token)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('il bitonale forzato fallisce chiuso se la provenienza pagina è incompleta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-force-provenance-'))
    const input = join(dir, 'synthetic-color.pdf')
    await writeRasterPdf(input, [colorPage(257, 129)], 257, 129)
    try {
      await expect(generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        rasterCodec: 'bitonal-force',
      })).rejects.toMatchObject({ code: 'validation-failed' })
      await expectNoOutputOrTemp(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('il bitonale forzato fallisce chiuso su una pagina non verificata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-force-page-error-'))
    const input = join(dir, 'synthetic-color.pdf')
    await writeRasterPdf(input, [colorPage(257, 129)], 257, 129)
    try {
      await expect(generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [{ ...scanSafety(1), status: 'page-error', layerKind: null, reason: 'page-error' }],
        rasterCodec: 'bitonal-force',
      })).rejects.toMatchObject({ code: 'validation-failed' })
      await expectNoOutputOrTemp(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('riduce sotto il 60% del JPEG la stessa fixture bianco-nero grande e deterministica', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-size-'))
    const input = join(dir, 'synthetic-large.pdf')
    await writeRasterPdf(
      input,
      [largeMonochromePage()],
      LARGE_BITONAL_FIXTURE_WIDTH,
      LARGE_BITONAL_FIXTURE_HEIGHT,
    )
    try {
      const options = {
        routing: 'flattened-scan' as const,
        layerKind: 'scan-with-text' as const,
        pageSafety: [scanSafety(1)],
      }
      const jpeg = await generatePdfSafe(input, [], options)
      const bitonal = await generatePdfSafe(input, [], { ...options, rasterCodec: 'bitonal-auto' })
      const jpegOutput = await readFile(jpeg.outputPath)
      const bitonalOutput = await readFile(bitonal.outputPath)
      const jpegBytes = jpegOutput.byteLength
      const bitonalBytes = bitonalOutput.byteLength
      const mupdf = (await import('mupdf')).default
      const jpegDocument = new mupdf.PDFDocument(new Uint8Array(jpegOutput))
      const bitonalDocument = new mupdf.PDFDocument(new Uint8Array(bitonalOutput))
      try {
        expect(pageImages(jpegDocument, 0)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
        expect(pageImages(bitonalDocument, 0)).toEqual([{ bits: 1, colorSpace: 'Gray' }])
      } finally {
        jpegDocument.destroy()
        bitonalDocument.destroy()
      }
      // Gate intenzionalmente largo e limitato a questa fixture grande: su PDF
      // piccoli l'overhead del contenitore renderebbe il rapporto poco informativo.
      expect(bitonalBytes).toBeLessThan(jpegBytes * 0.60)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('mantiene JPEG senza una pageSafety completa e biunivoca', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-provenance-'))
    const input = join(dir, 'synthetic.pdf')
    await writeRasterPdf(input, [grayPage(240, 100), grayPage(240, 100)], 240, 100)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1), scanSafety(2), scanSafety(3)],
        rasterCodec: 'bitonal-auto',
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
        expect(pageImages(output, 1)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserva in JPEG un tratto grigio 180 localizzato', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-faded-'))
    const input = join(dir, 'synthetic-faded.pdf')
    const raw = fadedPage(1000, 100)
    await writeRasterPdf(input, [raw], 1000, 100)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)],
        rasterCodec: 'bitonal-auto',
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
      } finally {
        output.destroy()
      }
      const extracted = await extractFirstImage(result.outputPath, dir, 'faded')
      const center = (61 * extracted.width + 401) * extracted.channels
      expect(Math.abs(extracted.data[center] - 180)).toBeLessThanOrEqual(30)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserva in JPEG nove pixel blu distribuiti tre per blocco', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-blue-'))
    const input = join(dir, 'synthetic-blue.pdf')
    const raw = distributedBluePage(1000, 100)
    await writeRasterPdf(input, [raw], 1000, 100)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan', layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)], rasterCodec: 'bitonal-auto',
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
      } finally {
        output.destroy()
      }
      const extracted = await extractFirstImage(result.outputPath, dir, 'blue')
      let maxChroma = 0
      for (let y = 58; y < 63; y++) {
        for (let x = 398; x < 437; x++) {
          const offset = (y * extracted.width + x) * extracted.channels
          const channels = [...extracted.data.subarray(offset, offset + 3)]
          maxChroma = Math.max(maxChroma, Math.max(...channels) - Math.min(...channels))
        }
      }
      expect(maxChroma).toBeGreaterThan(10)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('usa JPEG per colore e fotografia e consente codec misti pagina per pagina', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-mixed-'))
    const input = join(dir, 'synthetic-mixed.pdf')
    await writeRasterPdf(
      input,
      [grayPage(240, 100), colorPage(240, 100), photoPage(240, 100), grayPage(240, 100)],
      240,
      100,
    )
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1), scanSafety(2), scanSafety(3), digitalSafety(4)],
        rasterCodec: 'bitonal-auto',
      })
      const mupdf = (await import('mupdf')).default
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(pageImages(output, 0)).toEqual([{ bits: 1, colorSpace: 'Gray' }])
        expect(pageImages(output, 1)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
        expect(pageImages(output, 2)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
        expect(pageImages(output, 3)).toEqual([{ bits: 8, colorSpace: 'RGB' }])
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each(['selector', 'pack'] as const)('un errore tecnico %s nel forzato fallisce chiuso senza output o temporanei', async (stage) => {
    const dir = await mkdtemp(join(tmpdir(), `anonimator-bitonal-${stage}-`))
    const input = join(dir, 'synthetic.pdf')
    await writeRasterPdf(input, [grayPage(240, 100)], 240, 100)
    bitonalFailures[stage] = true
    try {
      await expect(generatePdfSafe(input, [], {
        routing: 'flattened-scan', layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)], rasterCodec: 'bitonal-force',
      })).rejects.toMatchObject({ code: 'validation-failed' })
      await expectNoOutputOrTemp(dir)
    } finally {
      bitonalFailures[stage] = false
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('un errore tecnico di embedding fallisce chiuso senza output o temporanei', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-failure-'))
    const input = join(dir, 'synthetic.pdf')
    await writeRasterPdf(input, [grayPage(240, 100)], 240, 100)
    const codecFailure = vi.spyOn(PDFContext.prototype, 'flateStream').mockImplementation(() => {
      throw new Error('synthetic codec failure')
    })
    try {
      await expect(generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)],
        rasterCodec: 'bitonal-force',
      })).rejects.toMatchObject({ code: 'validation-failed' })
      await expectNoOutputOrTemp(dir)
    } finally {
      codecFailure.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('un errore di validazione del payload rimuove output e temporaneo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-validation-'))
    const input = join(dir, 'synthetic.pdf')
    await writeRasterPdf(input, [grayPage(240, 100)], 240, 100)
    const mupdf = (await import('mupdf')).default
    const validationFailure = vi.spyOn(mupdf.PDFObject.prototype, 'readStream').mockImplementation(() => {
      throw new Error('synthetic validation failure')
    })
    try {
      await expect(generatePdfSafe(input, [], {
        routing: 'flattened-scan', layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)], rasterCodec: 'bitonal-force',
      })).rejects.toMatchObject({ code: 'validation-failed' })
      await expectNoOutputOrTemp(dir)
    } finally {
      validationFailure.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('non copia attachment, payload identificativo o hash sintetico della sorgente', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-sanitize-'))
    const input = join(dir, 'synthetic.pdf')
    const payload = 'SYNTHETIC_ATTACHMENT_CANARY_065'
    const payloadHash = createHash('sha256').update(payload).digest('hex')
    const document = await PDFDocument.create()
    const raw = grayPage(240, 100)
    const png = await sharp(raw, { raw: { width: 240, height: 100, channels: 3 } }).png().toBuffer()
    const image = await document.embedPng(png)
    document.addPage([240, 100]).drawImage(image, { x: 0, y: 0, width: 240, height: 100 })
    await document.attach(Buffer.from(payload), 'synthetic-canary.txt', {
      mimeType: 'text/plain', description: payloadHash,
    })
    document.setSubject(`${payload}:${payloadHash}`)
    await writeFile(input, await document.save({ useObjectStreams: false }))
    try {
      const mupdf = (await import('mupdf')).default
      const source = new mupdf.PDFDocument(new Uint8Array(await readFile(input)))
      let sourceImageHash: string
      try {
        sourceImageHash = createHash('sha256')
          .update(soleImageXObject(source, 0).readStream().asUint8Array())
          .digest('hex')
      } finally {
        source.destroy()
      }
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan', layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)], rasterCodec: 'bitonal-auto',
      })
      const bytes = await readFile(result.outputPath)
      expect(bytes.toString('latin1')).not.toContain(payload)
      expect(bytes.toString('latin1')).not.toContain(payloadHash)
      const output = new mupdf.PDFDocument(new Uint8Array(bytes))
      try {
        expect(output.getEmbeddedFiles()).toEqual({})
        expect(pageImages(output, 0)).toEqual([{ bits: 1, colorSpace: 'Gray' }])
        const outputImageHash = createHash('sha256')
          .update(soleImageXObject(output, 0).readStream().asUint8Array())
          .digest('hex')
        expect(outputImageHash).not.toBe(sourceImageHash)
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('l’immagine estratta contiene il bitmask nuovo e non stream della sorgente', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-extract-'))
    const input = join(dir, 'synthetic.pdf')
    const raw = grayPage(240, 100)
    await writeRasterPdf(input, [raw], 240, 100)
    try {
      const result = await generatePdfSafe(input, [], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        pageSafety: [scanSafety(1)],
        rasterCodec: 'bitonal-auto',
      })
      const prefix = join(dir, 'extracted')
      execFileSync('pdfimages', ['-png', result.outputPath, prefix], { stdio: 'ignore' })
      const extracted = await sharp(`${prefix}-000.png`).raw().toBuffer({ resolveWithObject: true })
      expect(extracted.info.width).toBe(240)
      expect(extracted.info.height).toBe(100)
      expect([1, 3]).toContain(extracted.info.channels)
      const values = new Set<number>()
      for (let pixel = 0; pixel < extracted.info.width * extracted.info.height; pixel++) {
        const offset = pixel * extracted.info.channels
        const value = extracted.data[offset]
        values.add(value)
        for (let channel = 1; channel < extracted.info.channels; channel++) {
          expect(extracted.data[offset + channel]).toBe(value)
        }
      }
      expect([...values].sort((a, b) => a - b)).toEqual([0, 255])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('redige i pixel prima del packing bitonale e non altera una regione controllo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-bitonal-leak-'))
    const input = join(dir, 'synthetic-scan.pdf')
    await copyFile(ALIGNED_FIXTURE, input)
    const entity: DetectedEntity = {
      id: 'synthetic-person-1',
      type: 'PERSONA',
      originalText: 'Mario Rossi',
      pseudonym: 'PERSONA_1',
      occurrences: 1,
      confirmed: true,
    }
    const options = {
      routing: 'flattened-scan' as const,
      layerKind: 'scan-with-text' as const,
      ocrAligned: true,
      rasterCodec: 'bitonal-force' as const,
      pageSafety: [scanSafety(1)],
    }
    try {
      const reference = await generatePdfSafe(input, [], options)
      const result = await generatePdfSafe(input, [entity], options)
      expect(result.safetyStatus).toBe('complete')
      const before = await extractFirstImage(reference.outputPath, dir, 'before')
      const after = await extractFirstImage(result.outputPath, dir, 'after')
      expect({ width: after.width, height: after.height }).toEqual({ width: before.width, height: before.height })
      const scale = before.width / 595
      expect(changedFraction(before, after, [124 * scale, 131 * scale, 149 * scale, 141 * scale]))
        .toBeGreaterThan(0.45)
      expect(changedFraction(before, after, [300 * scale, 131 * scale, 440 * scale, 141 * scale]))
        .toBeLessThan(0.01)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
