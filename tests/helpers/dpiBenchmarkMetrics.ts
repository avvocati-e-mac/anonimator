import type { Rect } from '../../src/main/services/geometry'

export const DPI_BENCHMARK_SCHEMA_VERSION = 2 as const
export const DPI_BENCHMARK_CANDIDATES = [200, 300, 400] as const
export const DPI_BENCHMARK_FIXTURES = ['clean', 'small-7pt', 'degraded-150dpi'] as const
export type DpiBenchmarkFixture = (typeof DPI_BENCHMARK_FIXTURES)[number]

export interface TextAccuracyMetrics {
  sensitiveRecall: number
  tokenRecall: number
  wer: number
  cer: number
}

export interface GeometryAccuracyMetrics {
  coverage: number
  iou: number
  centerErrorPt: number
  maxEdgeErrorPt: number
}

export interface DpiBenchmarkRun {
  schemaVersion: typeof DPI_BENCHMARK_SCHEMA_VERSION
  fixture: DpiBenchmarkFixture
  sourceDpi: number
  ocrDpi: (typeof DPI_BENCHMARK_CANDIDATES)[number]
  outputRasterPolicy: 'source-native-independent-of-ocr-dpi'
  text: TextAccuracyMetrics
  geometry: GeometryAccuracyMetrics
  matchedTargets: number
  targetCount: number
  ocrMs: number
  outputMs: number
  totalMs: number
  baselineRssMiB: number
  peakRssMiB: number
  peakRssDeltaMiB: number
  peakHeapMiB: number
  inputBytes: number
  outputBytes: number
  outputSizeRatio: number
  safetyComplete: boolean
  acceptancePassed: boolean
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

export function normalizedTokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleUpperCase('it-IT').match(TOKEN_PATTERN) ?? []
}

function editDistance<T>(left: readonly T[], right: readonly T[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row++) {
    const current = [row]
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[right.length]
}

function lcsLength<T>(left: readonly T[], right: readonly T[]): number {
  let previous = Array(right.length + 1).fill(0) as number[]
  for (const item of left) {
    const current = Array(right.length + 1).fill(0) as number[]
    for (let column = 1; column <= right.length; column++) {
      current[column] = item === right[column - 1]
        ? previous[column - 1] + 1
        : Math.max(previous[column], current[column - 1])
    }
    previous = current
  }
  return previous[right.length]
}

function containsSequence(tokens: readonly string[], target: readonly string[]): boolean {
  if (target.length === 0 || target.length > tokens.length) return false
  return tokens.some((_, start) =>
    start + target.length <= tokens.length
    && target.every((part, offset) => tokens[start + offset] === part),
  )
}

/**
 * CER confronta i caratteri dopo NFKC, case-fold e rimozione degli spazi;
 * tokenRecall è la quota di token di riferimento nella LCS, quindi non accredita
 * riordinamenti. Le sequenze sensibili restano un gate exact-match separato.
 */
export function measureTextAccuracy(
  reference: string,
  recognized: string,
  sensitiveSequences: readonly string[],
): TextAccuracyMetrics {
  const expectedTokens = normalizedTokens(reference)
  const actualTokens = normalizedTokens(recognized)
  const expectedChars = expectedTokens.join('')
  const actualChars = actualTokens.join('')
  const hits = sensitiveSequences.filter((sequence) =>
    containsSequence(actualTokens, normalizedTokens(sequence)),
  ).length
  return {
    sensitiveRecall: sensitiveSequences.length ? hits / sensitiveSequences.length : 1,
    tokenRecall: expectedTokens.length ? lcsLength(expectedTokens, actualTokens) / expectedTokens.length : 1,
    wer: expectedTokens.length ? editDistance(expectedTokens, actualTokens) / expectedTokens.length : 0,
    cer: expectedChars.length ? editDistance([...expectedChars], [...actualChars]) / expectedChars.length : 0,
  }
}

function area(rect: Rect): number {
  return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0)
}

export function measureGeometry(expected: Rect, actual: Rect): GeometryAccuracyMetrics {
  const intersection: Rect = {
    x0: Math.max(expected.x0, actual.x0),
    y0: Math.max(expected.y0, actual.y0),
    x1: Math.min(expected.x1, actual.x1),
    y1: Math.min(expected.y1, actual.y1),
  }
  const expectedArea = area(expected)
  const actualArea = area(actual)
  const intersectionArea = area(intersection)
  const unionArea = expectedArea + actualArea - intersectionArea
  const expectedCenterX = (expected.x0 + expected.x1) / 2
  const expectedCenterY = (expected.y0 + expected.y1) / 2
  const actualCenterX = (actual.x0 + actual.x1) / 2
  const actualCenterY = (actual.y0 + actual.y1) / 2
  return {
    coverage: expectedArea ? intersectionArea / expectedArea : 0,
    iou: unionArea ? intersectionArea / unionArea : 0,
    centerErrorPt: Math.hypot(actualCenterX - expectedCenterX, actualCenterY - expectedCenterY),
    maxEdgeErrorPt: Math.max(
      Math.abs(actual.x0 - expected.x0),
      Math.abs(actual.y0 - expected.y0),
      Math.abs(actual.x1 - expected.x1),
      Math.abs(actual.y1 - expected.y1),
    ),
  }
}

function finiteUnit(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function isDpiBenchmarkRun(value: unknown): value is DpiBenchmarkRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Record<string, unknown>
  const text = run.text as Record<string, unknown> | undefined
  const geometry = run.geometry as Record<string, unknown> | undefined
  const nonNegative = [
    run.matchedTargets, run.targetCount, run.ocrMs, run.outputMs, run.totalMs,
    run.baselineRssMiB, run.peakRssMiB, run.peakRssDeltaMiB, run.peakHeapMiB,
    run.inputBytes, run.outputBytes, run.outputSizeRatio,
  ]
  return run.schemaVersion === DPI_BENCHMARK_SCHEMA_VERSION
    && DPI_BENCHMARK_FIXTURES.includes(run.fixture as DpiBenchmarkFixture)
    && typeof run.sourceDpi === 'number' && Number.isInteger(run.sourceDpi) && run.sourceDpi > 0
    && DPI_BENCHMARK_CANDIDATES.includes(run.ocrDpi as 200 | 300 | 400)
    && run.outputRasterPolicy === 'source-native-independent-of-ocr-dpi'
    && typeof run.safetyComplete === 'boolean'
    && typeof run.acceptancePassed === 'boolean'
    && nonNegative.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)
    && !!text
    && finiteUnit(text.sensitiveRecall)
    && finiteUnit(text.tokenRecall)
    && typeof text.wer === 'number' && Number.isFinite(text.wer) && text.wer >= 0
    && typeof text.cer === 'number' && Number.isFinite(text.cer) && text.cer >= 0
    && !!geometry
    && finiteUnit(geometry.coverage)
    && finiteUnit(geometry.iou)
    && [geometry.centerErrorPt, geometry.maxEdgeErrorPt]
      .every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)
}

export function expectedSourceDpi(fixture: DpiBenchmarkFixture): number {
  return fixture === 'degraded-150dpi' ? 150 : 300
}

export function acceptanceForRun(run: Omit<DpiBenchmarkRun, 'acceptancePassed'>): boolean {
  const textFloor = run.fixture === 'clean' ? 0.98 : run.fixture === 'small-7pt' ? 0.90 : 0.85
  const cerCeiling = run.fixture === 'clean' ? 0.02 : run.fixture === 'small-7pt' ? 0.08 : 0.12
  return run.text.sensitiveRecall === 1
    && run.safetyComplete
    && run.matchedTargets === run.targetCount
    && run.geometry.centerErrorPt <= 4
    && run.text.tokenRecall >= textFloor
    && run.text.cer <= cerCeiling
}

export function hasCoherentDpiMatrix(runs: readonly DpiBenchmarkRun[], repetitions: number): boolean {
  if (!Number.isInteger(repetitions) || repetitions < 1) return false
  if (runs.length !== DPI_BENCHMARK_FIXTURES.length * DPI_BENCHMARK_CANDIDATES.length * repetitions) return false
  return DPI_BENCHMARK_FIXTURES.every((fixture) => DPI_BENCHMARK_CANDIDATES.every((ocrDpi) => {
    const matching = runs.filter((run) => run.fixture === fixture && run.ocrDpi === ocrDpi)
    return matching.length === repetitions
      && matching.every((run) => isDpiBenchmarkRun(run) && run.sourceDpi === expectedSourceDpi(fixture))
  }))
}
