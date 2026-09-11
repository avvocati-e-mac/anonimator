import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  DPI_BENCHMARK_SCHEMA_VERSION,
  acceptanceForRun,
  hasCoherentDpiMatrix,
  isDpiBenchmarkRun,
  measureGeometry,
  measureTextAccuracy,
  normalizedTokens,
} from './helpers/dpiBenchmarkMetrics'

describe('metriche benchmark DPI', () => {
  it('normalizza Unicode e misura recall, WER e CER deterministicamente', () => {
    expect(normalizedTokens('  Ente—Àlfa, codice 73. ')).toEqual(['ENTE', 'ÀLFA', 'CODICE', '73'])
    expect(measureTextAccuracy(
      'ENTE ALFA CODICE FIXTURE 7391 TESTO FINALE',
      'ENTE ALFA CODICE FIXTURE 739I TESTO',
      ['ENTE ALFA', 'CODICE FIXTURE 7391'],
    )).toEqual({
      sensitiveRecall: 0.5,
      tokenRecall: 5 / 7,
      wer: 2 / 7,
      cer: 7 / 36,
    })
  })

  it('misura copertura, IoU ed errore geometrico in punti', () => {
    expect(measureGeometry(
      { x0: 10, y0: 20, x1: 30, y1: 40 },
      { x0: 12, y0: 18, x1: 32, y1: 38 },
    )).toEqual({
      coverage: 0.81,
      iou: 324 / 476,
      centerErrorPt: Math.sqrt(8),
      maxEdgeErrorPt: 2,
    })
  })

  it('valida uno schema run chiuso ai DPI candidati', () => {
    const run = {
      schemaVersion: DPI_BENCHMARK_SCHEMA_VERSION,
      fixture: 'clean' as const,
      sourceDpi: 300,
      ocrDpi: 300 as const,
      outputRasterPolicy: 'source-native-independent-of-ocr-dpi' as const,
      text: { sensitiveRecall: 1, tokenRecall: 0.9, wer: 0.1, cer: 0.02 },
      geometry: { coverage: 0.95, iou: 0.8, centerErrorPt: 1, maxEdgeErrorPt: 2 },
      matchedTargets: 2, targetCount: 2,
      ocrMs: 100, outputMs: 50, totalMs: 150,
      baselineRssMiB: 100, peakRssMiB: 180, peakRssDeltaMiB: 80, peakHeapMiB: 40,
      inputBytes: 1000, outputBytes: 900, outputSizeRatio: 0.9,
      safetyComplete: true,
      acceptancePassed: true,
    }
    expect(isDpiBenchmarkRun(run)).toBe(true)
    expect(isDpiBenchmarkRun({ ...run, ocrDpi: 250 })).toBe(false)
    expect(isDpiBenchmarkRun({ ...run, text: { ...run.text, sensitiveRecall: 1.1 } })).toBe(false)
  })

  it('applica gate prudenti senza mediare un falso negativo sensibile', () => {
    const base = {
      schemaVersion: DPI_BENCHMARK_SCHEMA_VERSION,
      fixture: 'degraded-150dpi' as const,
      sourceDpi: 150,
      ocrDpi: 300 as const,
      outputRasterPolicy: 'source-native-independent-of-ocr-dpi' as const,
      text: { sensitiveRecall: 1, tokenRecall: 0.85, wer: 0.1, cer: 0.12 },
      geometry: { coverage: 0.5, iou: 0.5, centerErrorPt: 4, maxEdgeErrorPt: 5 },
      matchedTargets: 3, targetCount: 3,
      ocrMs: 1, outputMs: 1, totalMs: 2,
      baselineRssMiB: 1, peakRssMiB: 2, peakRssDeltaMiB: 1, peakHeapMiB: 1,
      inputBytes: 1, outputBytes: 1, outputSizeRatio: 1,
      safetyComplete: true,
    }
    expect(acceptanceForRun(base)).toBe(true)
    expect(acceptanceForRun({ ...base, text: { ...base.text, sensitiveRecall: 2 / 3 } })).toBe(false)
    expect(acceptanceForRun({ ...base, matchedTargets: 2 })).toBe(false)
    expect(acceptanceForRun({ ...base, geometry: { ...base.geometry, centerErrorPt: 4.01 } })).toBe(false)
  })

  it('rifiuta matrici parent incomplete, duplicate o con source DPI incoerente', () => {
    const makeRun = (fixture: 'clean' | 'small-7pt' | 'degraded-150dpi', ocrDpi: 200 | 300 | 400) => ({
      schemaVersion: DPI_BENCHMARK_SCHEMA_VERSION,
      fixture,
      sourceDpi: fixture === 'degraded-150dpi' ? 150 : 300,
      ocrDpi,
      outputRasterPolicy: 'source-native-independent-of-ocr-dpi' as const,
      text: { sensitiveRecall: 1, tokenRecall: 1, wer: 0, cer: 0 },
      geometry: { coverage: 1, iou: 1, centerErrorPt: 0, maxEdgeErrorPt: 0 },
      matchedTargets: 3, targetCount: 3,
      ocrMs: 1, outputMs: 1, totalMs: 2,
      baselineRssMiB: 1, peakRssMiB: 2, peakRssDeltaMiB: 1, peakHeapMiB: 1,
      inputBytes: 1, outputBytes: 1, outputSizeRatio: 1,
      safetyComplete: true, acceptancePassed: true,
    })
    const matrix = (['clean', 'small-7pt', 'degraded-150dpi'] as const)
      .flatMap((fixture) => ([200, 300, 400] as const).map((dpi) => makeRun(fixture, dpi)))
    expect(hasCoherentDpiMatrix(matrix, 1)).toBe(true)
    expect(hasCoherentDpiMatrix(matrix.slice(1), 1)).toBe(false)
    expect(hasCoherentDpiMatrix([...matrix.slice(0, -1), matrix[0]], 1)).toBe(false)
    expect(hasCoherentDpiMatrix(matrix.map((run, index) => index ? run : { ...run, sourceDpi: 150 }), 1)).toBe(false)
  })

  it('su input parent non valido emette soltanto un codice fisso', () => {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'benchmark-dpi.mjs'),
      '--repetitions=0',
    ], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('DPI_BENCH_INVALID_REPETITIONS\n')
  })
})
