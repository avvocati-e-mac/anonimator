import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import type { DetectedEntity } from '../../src/shared/types'
import type { PdfPageQualityOutcome } from '../../src/main/services/ocrLayerCheck'
import {
  LARGE_BITONAL_FIXTURE_HEIGHT,
  LARGE_BITONAL_FIXTURE_WIDTH,
  largeMonochromePage,
} from '../helpers/bitonalManualFixtures'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() },
}))

import { generatePdfSafe } from '../../src/main/outputGenerators/pdfSafeGenerator'
import { ocrArtifactCache } from '../../src/main/services/ocrArtifactCache'

const WIDTH = 1000
const HEIGHT = 240
const SENSITIVE_TOKEN = 'SYNTHETIC_TOKEN_065'
const PSEUDONYM = 'PERSONA_1'

interface FixtureReport {
  id: 'pure-bw' | 'faded-180' | 'dark-chroma' | 'redacted-searchable'
  expectedCodec: 'bitonal' | 'jpeg'
  actualCodec: 'bitonal' | 'jpeg'
  checks: Record<string, boolean>
  sizeComparison?: {
    jpegBytes: number
    bitonalBytes: number
    bitonalToJpegRatio: number
    maximumRatio: number
  }
}

function manualDirectory(): string {
  const requested = process.env.ANONIMATOR_MANUAL_BITONAL_DIR
  if (process.env.ANONIMATOR_MANUAL_BITONAL !== '1' || !requested || !isAbsolute(requested)) {
    throw new Error('MANUAL_BITONAL_ENV_INVALID')
  }
  const outputRoot = resolve(process.cwd(), 'manual-test-output')
  const target = resolve(requested)
  const child = relative(outputRoot, target)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('MANUAL_BITONAL_DIR_INVALID')
  return target
}

function setPixel(rgb: Buffer, x: number, y: number, color: readonly [number, number, number]): void {
  const offset = (y * WIDTH + x) * 3
  rgb[offset] = color[0]
  rgb[offset + 1] = color[1]
  rgb[offset + 2] = color[2]
}

function purePage(): Buffer {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3, 255)
  for (let row = 0; row < 7; row++) {
    const y0 = 25 + row * 25
    for (let y = y0; y < y0 + 7; y++) {
      for (let x = 40; x < 840; x++) {
        if ((x % 18) < 11) setPixel(rgb, x, y, [0, 0, 0])
      }
    }
  }
  return rgb
}

function fadedPage(): Buffer {
  const rgb = purePage()
  for (let y = 195; y < 199; y++) {
    for (let x = 400; x < 440; x++) setPixel(rgb, x, y, [180, 180, 180])
  }
  return rgb
}

function darkChromaPage(): Buffer {
  const rgb = purePage()
  for (const startX of [400, 416, 432]) {
    for (let x = startX; x < startX + 3; x++) setPixel(rgb, x, 198, [0, 0, 100])
  }
  return rgb
}

async function redactionPage(): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`
      + '<rect width="100%" height="100%" fill="white"/>'
      + `<text x="110" y="135" font-family="sans-serif" font-size="54" fill="black">${SENSITIVE_TOKEN}</text>`
      + '</svg>',
  )
  const rendered = await sharp(svg)
    .flatten({ background: '#fff' })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (rendered.info.channels !== 1 || rendered.data.byteLength !== WIDTH * HEIGHT) {
    throw new Error('MANUAL_BITONAL_FIXTURE_INVALID')
  }
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3)
  for (let pixel = 0; pixel < rendered.data.byteLength; pixel++) {
    rgb[pixel * 3] = rendered.data[pixel]
    rgb[pixel * 3 + 1] = rendered.data[pixel]
    rgb[pixel * 3 + 2] = rendered.data[pixel]
  }
  return rgb
}

async function writeRasterPdf(
  filePath: string,
  raw: Buffer,
  width = WIDTH,
  height = HEIGHT,
): Promise<void> {
  const document = await PDFDocument.create()
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const image = await document.embedPng(png)
  document.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  await writeFile(filePath, await document.save())
}

function scanSafety(status: 'scan-aligned' | 'scan-untrusted'): PdfPageQualityOutcome[] {
  return [{
    page: 1,
    status,
    layerKind: status === 'scan-aligned' ? 'scan-with-text' : 'scan-no-text',
    existingTextLayerUsable: status === 'scan-aligned',
    reason: status === 'scan-aligned' ? 'ok' : 'no-text-layer',
    metrics: {
      coverage: status === 'scan-aligned' ? 1 : null,
      lift: status === 'scan-aligned' ? 2 : null,
      lineAgreement: status === 'scan-aligned' ? 1 : null,
      scaleY: status === 'scan-aligned' ? 1 : null,
      offsetXPt: status === 'scan-aligned' ? 0 : null,
      offsetYPt: status === 'scan-aligned' ? 0 : null,
    },
    imageMetrics: null,
  }]
}

async function inspectCodec(filePath: string): Promise<'bitonal' | 'jpeg'> {
  const mupdf = (await import('mupdf')).default
  const document = new mupdf.PDFDocument(new Uint8Array(await readFile(filePath)))
  const page = document.loadPage(0)
  const structured = page.toStructuredText('preserve-images')
  const formats: Array<{ bits: number; colorSpace: string | null }> = []
  try {
    structured.walk({ onImageBlock(_bbox, _matrix, image) {
      formats.push({
        bits: image.getBitsPerComponent(),
        colorSpace: image.getColorSpace()?.getType() ?? null,
      })
    } })
  } finally {
    structured.destroy()
    page.destroy()
    document.destroy()
  }
  if (formats.length !== 1) throw new Error('MANUAL_BITONAL_IMAGE_COUNT_INVALID')
  if (formats[0].bits === 1 && formats[0].colorSpace === 'Gray') return 'bitonal'
  if (formats[0].bits === 8 && formats[0].colorSpace === 'RGB') return 'jpeg'
  throw new Error('MANUAL_BITONAL_CODEC_INVALID')
}

async function extractImage(pdfPath: string, prefix: string): Promise<{
  data: Buffer
  width: number
  height: number
  channels: number
}> {
  execFileSync('pdfimages', ['-png', pdfPath, prefix], { stdio: 'ignore' })
  const extracted = await sharp(`${prefix}-000.png`).raw().toBuffer({ resolveWithObject: true })
  return {
    data: extracted.data,
    width: extracted.info.width,
    height: extracted.info.height,
    channels: extracted.info.channels,
  }
}

function renderPreview(pdfPath: string, outputPrefix: string): void {
  execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-png', '-r', '110', pdfPath, outputPrefix], {
    stdio: 'ignore',
  })
}

function changedFraction(
  before: Awaited<ReturnType<typeof extractImage>>,
  after: Awaited<ReturnType<typeof extractImage>>,
  box: readonly [number, number, number, number],
): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error('MANUAL_BITONAL_GEOMETRY_INVALID')
  }
  const [x0, y0, x1, y1] = box
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

async function searchableText(pdfPath: string): Promise<string> {
  const mupdf = (await import('mupdf')).default
  const document = new mupdf.PDFDocument(new Uint8Array(await readFile(pdfPath)))
  const page = document.loadPage(0)
  const structured = page.toStructuredText('preserve-whitespace')
  try {
    return structured.asText()
  } finally {
    structured.destroy()
    page.destroy()
    document.destroy()
  }
}

async function generateSimpleFixture(
  runDirectory: string,
  ordinal: string,
  id: FixtureReport['id'],
  raw: Buffer,
  expectedCodec: 'bitonal' | 'jpeg',
  compareWithDefaultJpeg = false,
  dimensions: { width: number; height: number } = { width: WIDTH, height: HEIGHT },
): Promise<{ report: FixtureReport; extracted: Awaited<ReturnType<typeof extractImage>> }> {
  const fixtureDirectory = join(runDirectory, `${ordinal}-${id}`)
  await mkdir(fixtureDirectory)
  const source = join(fixtureDirectory, 'source.pdf')
  await writeRasterPdf(source, raw, dimensions.width, dimensions.height)
  let jpegBytes: number | null = null
  let defaultJpeg = false
  if (compareWithDefaultJpeg) {
    const jpeg = await generatePdfSafe(source, [], {
      routing: 'flattened-scan',
      layerKind: 'scan-with-text',
      pageSafety: scanSafety('scan-aligned'),
    })
    const jpegReference = join(fixtureDirectory, 'reference-jpeg.pdf')
    await rename(jpeg.outputPath, jpegReference)
    renderPreview(jpegReference, join(fixtureDirectory, 'reference-jpeg'))
    jpegBytes = (await readFile(jpegReference)).byteLength
    defaultJpeg = await inspectCodec(jpegReference) === 'jpeg'
    expect(defaultJpeg).toBe(true)
  }
  const result = await generatePdfSafe(source, [], {
    routing: 'flattened-scan',
    layerKind: 'scan-with-text',
    pageSafety: scanSafety('scan-aligned'),
    rasterCodec: 'bitonal-auto',
  })
  const output = join(fixtureDirectory, 'output.pdf')
  await rename(result.outputPath, output)
  renderPreview(source, join(fixtureDirectory, 'source'))
  renderPreview(output, join(fixtureDirectory, 'output'))
  const actualCodec = await inspectCodec(output)
  const extracted = await extractImage(output, join(fixtureDirectory, 'image'))
  expect(actualCodec).toBe(expectedCodec)
  const bitonalBytes = (await readFile(output)).byteLength
  const sizeComparison = jpegBytes === null ? undefined : {
    jpegBytes,
    bitonalBytes,
    bitonalToJpegRatio: bitonalBytes / jpegBytes,
    maximumRatio: 0.60,
  }
  if (sizeComparison) expect(sizeComparison.bitonalToJpegRatio).toBeLessThan(sizeComparison.maximumRatio)
  return {
    report: {
      id,
      expectedCodec,
      actualCodec,
      checks: {
        codecMatches: actualCodec === expectedCodec,
        ...(compareWithDefaultJpeg ? { defaultJpeg } : {}),
      },
      sizeComparison,
    },
    extracted,
  }
}

describe.runIf(process.env.ANONIMATOR_MANUAL_BITONAL === '1')('pacchetto manuale bitonale sintetico', () => {
  it('genera artefatti soltanto dopo avere superato tutti gli oracoli', async () => {
    const runDirectory = manualDirectory()
    const reports: FixtureReport[] = []

    const pure = await generateSimpleFixture(
      runDirectory,
      '01',
      'pure-bw',
      largeMonochromePage(),
      'bitonal',
      true,
      { width: LARGE_BITONAL_FIXTURE_WIDTH, height: LARGE_BITONAL_FIXTURE_HEIGHT },
    )
    pure.report.checks.binaryOutput = new Set(pure.extracted.data).size <= 2
    pure.report.checks.sizeReduction = (pure.report.sizeComparison?.bitonalToJpegRatio ?? 1) < 0.60
    expect(pure.report.checks.binaryOutput).toBe(true)
    expect(pure.report.checks.sizeReduction).toBe(true)
    reports.push(pure.report)

    const faded = await generateSimpleFixture(runDirectory, '02', 'faded-180', fadedPage(), 'jpeg')
    const fadedOffset = (196 * faded.extracted.width + 420) * faded.extracted.channels
    const fadedValue = faded.extracted.data[fadedOffset]
    faded.report.checks.midtonePreserved = Math.abs(fadedValue - 180) <= 30
    expect(faded.report.checks.midtonePreserved).toBe(true)
    reports.push(faded.report)

    const chroma = await generateSimpleFixture(runDirectory, '03', 'dark-chroma', darkChromaPage(), 'jpeg')
    let maximumChroma = 0
    for (let y = 196; y <= 200; y++) {
      for (let x = 398; x <= 438; x++) {
        const offset = (y * chroma.extracted.width + x) * chroma.extracted.channels
        const channels = [...chroma.extracted.data.subarray(offset, offset + 3)]
        maximumChroma = Math.max(maximumChroma, Math.max(...channels) - Math.min(...channels))
      }
    }
    chroma.report.checks.chromaPreserved = maximumChroma > 10
    expect(chroma.report.checks.chromaPreserved).toBe(true)
    reports.push(chroma.report)

    const redactionDirectory = join(runDirectory, '04-redacted-searchable')
    await mkdir(redactionDirectory)
    const redactionSource = join(redactionDirectory, 'source.pdf')
    await writeRasterPdf(redactionSource, await redactionPage())
    const analysisToken = 'c'.repeat(64)
    const sensitiveBox = { x0: 85, y0: 75, x1: 780, y1: 155 }
    const handle = ocrArtifactCache.stage({ pages: [{
      page: 1,
      renderMatrix: [1, 0, 0, 1, 0, 0],
      pixmapOrigin: { x: 0, y: 0 },
      words: [{ text: SENSITIVE_TOKEN, bbox: sensitiveBox, confidence: 99, line: 0, page: 1 }],
    }] })
    ocrArtifactCache.bind(handle, analysisToken)
    const entity: DetectedEntity = {
      id: 'synthetic-entity-065',
      type: 'PERSONA',
      originalText: SENSITIVE_TOKEN,
      pseudonym: PSEUDONYM,
      occurrences: 1,
      expectedOccurrences: 1,
      confirmed: true,
    }
    try {
      const result = await generatePdfSafe(redactionSource, [entity], {
        routing: 'flattened-scan',
        layerKind: 'scan-no-text',
        pageSafety: scanSafety('scan-untrusted'),
        analysisToken,
        rasterCodec: 'bitonal-auto',
      })
      expect(result.safetyStatus).toBe('complete')
      const redactionOutput = join(redactionDirectory, 'output.pdf')
      await rename(result.outputPath, redactionOutput)
      renderPreview(redactionSource, join(redactionDirectory, 'source'))
      renderPreview(redactionOutput, join(redactionDirectory, 'output'))
      const actualCodec = await inspectCodec(redactionOutput)
      const text = await searchableText(redactionOutput)
      const sourcePixels = await extractImage(redactionSource, join(redactionDirectory, 'source-image'))
      const outputPixels = await extractImage(redactionOutput, join(redactionDirectory, 'output-image'))
      const checks = {
        codecMatches: actualCodec === 'bitonal',
        complete: result.safetyStatus === 'complete',
        sensitiveTokenAbsent: !text.includes(SENSITIVE_TOKEN),
        pseudonymPresent: text.includes(PSEUDONYM),
        sensitivePixelsChanged: changedFraction(sourcePixels, outputPixels, [85, 75, 780, 155]) > 0.25,
        controlPixelsStable: changedFraction(sourcePixels, outputPixels, [800, 180, 950, 220]) < 0.001,
      }
      expect(Object.values(checks).every(Boolean)).toBe(true)
      reports.push({
        id: 'redacted-searchable',
        expectedCodec: 'bitonal',
        actualCodec,
        checks,
      })
    } finally {
      ocrArtifactCache.release(analysisToken)
    }

    const report = {
      schemaVersion: 1,
      status: 'ok',
      fixtureCount: reports.length,
      fixtures: reports,
    }
    await writeFile(join(runDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(join(runDirectory, 'README.md'), [
      '# Controllo manuale bitonale — fixture sintetiche',
      '',
      'Tutti i documenti in questa directory sono generati artificialmente e non contengono dati personali.',
      '',
      '## Checklist',
      '',
      '- `01-pure-bw/output.png`: segni grafici neri integri su fondo bianco.',
      '- `01-pure-bw/reference-jpeg.png`: confronto visivo col JPEG default della stessa sorgente.',
      '- In `report.json` il rapporto bitonale/JPEG della fixture `01` deve essere inferiore a `0.60`.',
      '- `02-faded-180/output.png`: il tratto grigio in basso resta visibile.',
      '- `03-dark-chroma/output.png`: i piccoli segni blu scuro in basso restano colorati.',
      '- `04-redacted-searchable/source.png` e `output.png`: la zona sensibile cambia e mostra lo pseudonimo.',
      '- `report.json`: tutti i booleani devono essere `true` e `status` deve essere `ok`.',
      '',
      'Non usare questi file come input dell’app e non copiarli nel repository: sono artefatti locali di sviluppo.',
      '',
    ].join('\n'))
  }, 60_000)
})
