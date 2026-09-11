import { describe, it, vi } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import type { DetectedEntity } from '../src/shared/types'
import type { Rect } from '../src/main/services/geometry'
import {
  DPI_BENCHMARK_CANDIDATES,
  DPI_BENCHMARK_FIXTURES,
  DPI_BENCHMARK_SCHEMA_VERSION,
  acceptanceForRun,
  isDpiBenchmarkRun,
  measureGeometry,
  measureTextAccuracy,
  type DpiBenchmarkRun,
  type GeometryAccuracyMetrics,
} from './helpers/dpiBenchmarkMetrics'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => process.env.ANONIMATOR_DPI_BENCH_USER_DATA ?? tmpdir(),
  },
}))

import { parsePdfWithOcr } from '../src/main/parsers/ocrParser'
import { generatePdfSafe } from '../src/main/outputGenerators/pdfSafeGenerator'
import { matchEntitiesOnPage } from '../src/main/services/entityMatcher'
import { renderedPixelRectToMupdf } from '../src/main/services/geometry'
import { ocrArtifactCache } from '../src/main/services/ocrArtifactCache'

const RUN_BENCHMARK = process.env.ANONIMATOR_DPI_BENCH_CHILD === '1'
const PAGE_WIDTH = 420
const PAGE_HEIGHT = 595
interface FixtureSpec {
  id: DpiBenchmarkRun['fixture']
  sourceDpi: number
  bodyPt: number
  targetPt: number
  jpegQuality: number
  noiseAmplitude: number
}

const FIXTURES: Record<DpiBenchmarkRun['fixture'], FixtureSpec> = {
  clean: { id: 'clean', sourceDpi: 300, bodyPt: 11, targetPt: 11, jpegQuality: 88, noiseAmplitude: 0 },
  'small-7pt': { id: 'small-7pt', sourceDpi: 300, bodyPt: 8, targetPt: 7, jpegQuality: 82, noiseAmplitude: 0 },
  'degraded-150dpi': { id: 'degraded-150dpi', sourceDpi: 150, bodyPt: 11, targetPt: 10, jpegQuality: 48, noiseAmplitude: 8 },
}
const REFERENCE_LINES = [
  'DOCUMENTO DI PROVA COMPLETAMENTE ARTIFICIALE',
  'ENTE OMEGA presenta una memoria tecnica sintetica.',
  'Il CODICE FIXTURE 7391 identifica soltanto questo collaudo.',
  'SOGGETTO ALFA compare come etichetta inventata.',
  'La procedura verifica caratteri piccoli e righe regolari.',
  'Nessun elemento di questa pagina appartiene a persone reali.',
] as const
const SENSITIVE = ['ENTE OMEGA', 'CODICE FIXTURE 7391', 'SOGGETTO ALFA'] as const

function rectFromQuads(quads: number[][]): Rect {
  const values = quads.flat()
  const xs = values.filter((_, index) => index % 2 === 0)
  const ys = values.filter((_, index) => index % 2 === 1)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

function addSeededNoise(pixels: Buffer, amplitude: number): void {
  if (!amplitude) return
  let state = 0x5eed7391
  for (let index = 0; index < pixels.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const delta = Math.round(((state / 0xffffffff) * 2 - 1) * amplitude)
    pixels[index] = Math.max(0, Math.min(255, pixels[index] + delta))
  }
}

async function createSyntheticScan(filePath: string, fixture: FixtureSpec): Promise<Map<string, Rect>> {
  const digital = await PDFDocument.create()
  const font = await digital.embedFont(StandardFonts.Helvetica)
  const page = digital.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(1, 1, 1) })
  REFERENCE_LINES.forEach((line, index) => page.drawText(line, {
    x: 38,
    y: PAGE_HEIGHT - 55 - index * 58,
    size: index === 0 ? Math.max(10, fixture.bodyPt + 2) : SENSITIVE.some((item) => line.includes(item)) ? fixture.targetPt : fixture.bodyPt,
    font,
    color: rgb(0.08, 0.08, 0.08),
  }))
  const digitalBytes = await digital.save()

  const mupdf = (await import('mupdf')).default
  const source = new mupdf.PDFDocument(Uint8Array.from(digitalBytes))
  const sourcePage = source.loadPage(0)
  let jpeg: Buffer
  const groundTruth = new Map<string, Rect>()
  try {
    for (const sequence of SENSITIVE) {
      const matches = sourcePage.search(sequence)
      if (matches.length !== 1) throw new Error('Fixture DPI sintetica non deterministica.')
      groundTruth.set(sequence, rectFromQuads(matches[0]))
    }
    const matrix = mupdf.Matrix.scale(fixture.sourceDpi / 72, fixture.sourceDpi / 72)
    const pixmap = sourcePage.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false)
    try {
      const pixels = Buffer.from(Uint8Array.from(pixmap.getPixels()))
      addSeededNoise(pixels, fixture.noiseAmplitude)
      jpeg = await sharp(pixels, {
        raw: { width: pixmap.getWidth(), height: pixmap.getHeight(), channels: 3 },
      }).jpeg({ quality: fixture.jpegQuality, chromaSubsampling: '4:2:0' }).toBuffer()
    } finally {
      pixmap.destroy()
    }
  } finally {
    sourcePage.destroy()
    source.destroy()
  }

  const scan = await PDFDocument.create()
  const image = await scan.embedJpg(jpeg)
  scan.addPage([PAGE_WIDTH, PAGE_HEIGHT]).drawImage(image, {
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
  })
  await writeFile(filePath, await scan.save({ useObjectStreams: true }))
  return groundTruth
}

function entities(): DetectedEntity[] {
  return SENSITIVE.map((originalText, index) => ({
    id: `synthetic-${index + 1}`,
    type: 'ORGANIZZAZIONE',
    originalText,
    pseudonym: `ETICHETTA_${index + 1}`,
    occurrences: 1,
    expectedOccurrences: 1,
    confirmed: true,
  }))
}

function aggregateGeometry(values: readonly GeometryAccuracyMetrics[]): GeometryAccuracyMetrics {
  if (!values.length) {
    return { coverage: 0, iou: 0, centerErrorPt: Math.hypot(PAGE_WIDTH, PAGE_HEIGHT), maxEdgeErrorPt: Math.max(PAGE_WIDTH, PAGE_HEIGHT) }
  }
  return {
    coverage: Math.min(...values.map((item) => item.coverage)),
    iou: Math.min(...values.map((item) => item.iou)),
    centerErrorPt: Math.max(...values.map((item) => item.centerErrorPt)),
    maxEdgeErrorPt: Math.max(...values.map((item) => item.maxEdgeErrorPt)),
  }
}

describe.skipIf(!RUN_BENCHMARK)('benchmark DPI OCR sintetico', () => {
  it('misura la pipeline reale senza persistere contenuto', async () => {
    const dpi = Number(process.env.ANONIMATOR_DPI_BENCH_DPI)
    const resultFile = process.env.ANONIMATOR_DPI_BENCH_RESULT
    const fixtureId = process.env.ANONIMATOR_DPI_BENCH_FIXTURE
    if (!DPI_BENCHMARK_CANDIDATES.includes(dpi as 200 | 300 | 400)) throw new Error('DPI_BENCH_INVALID_OCR_DPI')
    if (!resultFile) throw new Error('DPI_BENCH_MISSING_RESULT')
    if (!DPI_BENCHMARK_FIXTURES.includes(fixtureId as DpiBenchmarkRun['fixture'])) throw new Error('DPI_BENCH_INVALID_FIXTURE')
    const fixture = FIXTURES[fixtureId as DpiBenchmarkRun['fixture']]

    const dir = await mkdtemp(join(tmpdir(), 'anonimator-dpi-bench-'))
    const input = join(dir, 'synthetic-scan.pdf')
    const token = 'd'.repeat(64)
    const cacheBefore = ocrArtifactCache.stats()
    let pendingHandle: string | undefined
    let sampler: ReturnType<typeof setInterval> | undefined
    try {
      const groundTruth = await createSyntheticScan(input, fixture)
      const inputBytes = (await stat(input)).size
      const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc
      gc?.()
      const baseline = process.memoryUsage()
      let peakRss = baseline.rss
      let peakHeap = baseline.heapUsed
      sampler = setInterval(() => {
        const memory = process.memoryUsage()
        peakRss = Math.max(peakRss, memory.rss)
        peakHeap = Math.max(peakHeap, memory.heapUsed)
      }, 20)

      const started = performance.now()
      const ocrStarted = performance.now()
      const parsed = await parsePdfWithOcr(input, { dpi })
      const ocrMs = performance.now() - ocrStarted
      pendingHandle = parsed.ocrArtifactHandle
      if (!pendingHandle) throw new Error('DPI_BENCH_MISSING_ARTIFACT_HANDLE')
      ocrArtifactCache.bind(pendingHandle, token)
      pendingHandle = undefined
      const artifact = ocrArtifactCache.get(token)
      const artifactPage = artifact?.pages[0]
      if (!artifactPage || artifact.pages.length !== 1) throw new Error('DPI_BENCH_INVALID_ARTIFACT')
      const targets = entities()
      const matches = matchEntitiesOnPage(artifactPage.words, targets.map((entity) => ({
        entityId: entity.id,
        type: entity.type,
        originalText: entity.originalText,
      })), { page: 0 })
      const geometryValues: GeometryAccuracyMetrics[] = []
      for (const [index, target] of targets.entries()) {
        const match = matches.find((candidate) => candidate.entityId === target.id && candidate.status === 'matched')
        if (!match?.box) continue
        const actual = renderedPixelRectToMupdf(match.box, artifactPage.renderMatrix, artifactPage.pixmapOrigin)
        const expected = groundTruth.get(SENSITIVE[index])
        if (!expected) throw new Error('DPI_BENCH_MISSING_GROUND_TRUTH')
        geometryValues.push(measureGeometry(expected, actual))
      }

      const outputStarted = performance.now()
      const generated = await generatePdfSafe(input, targets, {
        routing: 'flattened-scan',
        layerKind: 'scan-no-text',
        pageSafety: [{
          page: 1,
          status: 'scan-untrusted',
          layerKind: 'scan-no-text',
          existingTextLayerUsable: false,
          reason: 'no-text-layer',
          metrics: { coverage: null, lift: null, lineAgreement: null, scaleY: null, offsetXPt: null, offsetYPt: null },
          imageMetrics: null,
        }],
        analysisToken: token,
      })
      const outputMs = performance.now() - outputStarted
      const totalMs = performance.now() - started
      const finalMemory = process.memoryUsage()
      peakRss = Math.max(peakRss, finalMemory.rss)
      peakHeap = Math.max(peakHeap, finalMemory.heapUsed)
      clearInterval(sampler)
      sampler = undefined
      const outputBytes = (await stat(generated.outputPath)).size
      const mib = 1024 * 1024
      const candidate: Omit<DpiBenchmarkRun, 'acceptancePassed'> = {
        schemaVersion: DPI_BENCHMARK_SCHEMA_VERSION,
        fixture: fixture.id,
        sourceDpi: fixture.sourceDpi,
        ocrDpi: dpi as DpiBenchmarkRun['ocrDpi'],
        outputRasterPolicy: 'source-native-independent-of-ocr-dpi',
        text: measureTextAccuracy(REFERENCE_LINES.join(' '), parsed.text, SENSITIVE),
        geometry: aggregateGeometry(geometryValues),
        matchedTargets: geometryValues.length,
        targetCount: SENSITIVE.length,
        ocrMs,
        outputMs,
        totalMs,
        baselineRssMiB: baseline.rss / mib,
        peakRssMiB: peakRss / mib,
        peakRssDeltaMiB: Math.max(0, peakRss - baseline.rss) / mib,
        peakHeapMiB: peakHeap / mib,
        inputBytes,
        outputBytes,
        outputSizeRatio: outputBytes / inputBytes,
        safetyComplete: generated.safetyStatus === 'complete',
      }
      const run: DpiBenchmarkRun = { ...candidate, acceptancePassed: acceptanceForRun(candidate) }
      if (!isDpiBenchmarkRun(run)) throw new Error('DPI_BENCH_INVALID_RUN_SCHEMA')
      await writeFile(resultFile, JSON.stringify(run), { flag: 'wx' })
    } finally {
      if (sampler) clearInterval(sampler)
      ocrArtifactCache.discard(pendingHandle)
      ocrArtifactCache.release(token)
      const cacheAfter = ocrArtifactCache.stats()
      await rm(dir, { recursive: true, force: true })
      if (cacheAfter.active !== cacheBefore.active
        || cacheAfter.pending !== cacheBefore.pending
        || cacheAfter.usedBytes !== cacheBefore.usedBytes) {
        throw new Error('DPI_BENCH_CACHE_LEAK')
      }
    }
  }, 180_000)
})
