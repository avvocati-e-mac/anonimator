#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const DPIS = [200, 300, 400]
const FIXTURES = [
  { id: 'clean', sourceDpi: 300 },
  { id: 'small-7pt', sourceDpi: 300 },
  { id: 'degraded-150dpi', sourceDpi: 150 },
]

function repetitionsFromArgs() {
  const inline = process.argv.find((argument) => argument.startsWith('--repetitions='))
  if (inline) return Number(inline.slice('--repetitions='.length))
  const index = process.argv.indexOf('--repetitions')
  return index >= 0 ? Number(process.argv[index + 1]) : 3
}

function tessdataFile() {
  const configured = process.env.ANONIMATOR_TESSDATA
  const candidates = [
    configured && basename(configured) === 'ita.traineddata' ? configured : configured && join(configured, 'ita.traineddata'),
    join(homedir(), 'Library', 'Application Support', 'anonimator', 'tessdata', 'ita.traineddata'),
    join(process.cwd(), 'resources', 'tessdata', 'ita.traineddata'),
    '/usr/share/tesseract-ocr/5/tessdata/ita.traineddata',
    '/usr/share/tesseract-ocr/4.00/tessdata/ita.traineddata',
  ].filter(Boolean)
  return candidates.find((candidate) => {
    try { return existsSync(candidate) && statSync(candidate).size > 1_000_000 } catch { return false }
  })
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function validUnit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function acceptance(run) {
  const tokenFloor = run.fixture === 'clean' ? 0.98 : run.fixture === 'small-7pt' ? 0.90 : 0.85
  const cerCeiling = run.fixture === 'clean' ? 0.02 : run.fixture === 'small-7pt' ? 0.08 : 0.12
  return run.text.sensitiveRecall === 1
    && run.safetyComplete
    && run.matchedTargets === run.targetCount
    && run.geometry.centerErrorPt <= 4
    && run.text.tokenRecall >= tokenFloor
    && run.text.cer <= cerCeiling
}

function validRun(run, fixture, ocrDpi) {
  const numeric = [
    run?.matchedTargets, run?.targetCount, run?.ocrMs, run?.outputMs, run?.totalMs,
    run?.baselineRssMiB, run?.peakRssMiB, run?.peakRssDeltaMiB, run?.peakHeapMiB,
    run?.inputBytes, run?.outputBytes, run?.outputSizeRatio,
    run?.geometry?.centerErrorPt, run?.geometry?.maxEdgeErrorPt, run?.text?.wer, run?.text?.cer,
  ]
  return run?.schemaVersion === 2
    && run.fixture === fixture.id
    && run.sourceDpi === fixture.sourceDpi
    && run.ocrDpi === ocrDpi
    && run.outputRasterPolicy === 'source-native-independent-of-ocr-dpi'
    && typeof run.safetyComplete === 'boolean'
    && typeof run.acceptancePassed === 'boolean'
    && numeric.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    && validUnit(run.text.sensitiveRecall) && validUnit(run.text.tokenRecall)
    && validUnit(run.geometry.coverage) && validUnit(run.geometry.iou)
    && run.acceptancePassed === acceptance(run)
}

function aggregate(fixture, ocrDpi, runs) {
  const values = (read) => runs.map(read)
  return {
    fixture: fixture.id,
    sourceDpi: fixture.sourceDpi,
    ocrDpi,
    runs: runs.length,
    acceptancePassed: runs.every((run) => run.acceptancePassed),
    sensitiveRecallMin: Math.min(...values((run) => run.text.sensitiveRecall)),
    tokenRecallMedian: median(values((run) => run.text.tokenRecall)),
    werMedian: median(values((run) => run.text.wer)),
    cerMedian: median(values((run) => run.text.cer)),
    geometryCoverageMin: Math.min(...values((run) => run.geometry.coverage)),
    geometryIouMin: Math.min(...values((run) => run.geometry.iou)),
    centerErrorPtMax: Math.max(...values((run) => run.geometry.centerErrorPt)),
    maxEdgeErrorPtMax: Math.max(...values((run) => run.geometry.maxEdgeErrorPt)),
    matchedTargetsMin: Math.min(...values((run) => run.matchedTargets)),
    targetCount: runs[0].targetCount,
    ocrMsMedian: median(values((run) => run.ocrMs)),
    outputMsMedian: median(values((run) => run.outputMs)),
    totalMsMedian: median(values((run) => run.totalMs)),
    peakRssMiBMedian: median(values((run) => run.peakRssMiB)),
    peakRssDeltaMiBMedian: median(values((run) => run.peakRssDeltaMiB)),
    peakHeapMiBMedian: median(values((run) => run.peakHeapMiB)),
    inputBytesMedian: median(values((run) => run.inputBytes)),
    outputBytesIndependentOfOcrDpiMedian: median(values((run) => run.outputBytes)),
    outputSizeRatioIndependentOfOcrDpiMedian: median(values((run) => run.outputSizeRatio)),
    safetyCompleteRate: values((run) => run.safetyComplete).filter(Boolean).length / runs.length,
  }
}

function main() {
  const repetitions = repetitionsFromArgs()
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('DPI_BENCH_INVALID_REPETITIONS')
  const trainedData = tessdataFile()
  if (!trainedData) throw new Error('DPI_BENCH_TESSDATA_UNAVAILABLE')

  const work = mkdtempSync(join(tmpdir(), 'anonimator-dpi-orchestrator-'))
  const vitest = resolve('node_modules/vitest/vitest.mjs')
  const runs = []
  try {
    // Ordine ruotato per non favorire sistematicamente un DPI per temperatura/cache.
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const order = DPIS.map((_, index) => DPIS[(index + repetition) % DPIS.length])
      for (const fixture of FIXTURES) for (const ocrDpi of order) {
        const resultFile = join(work, `run-${repetition}-${fixture.id}-${ocrDpi}.json`)
        const child = spawnSync(process.execPath, [
          '--expose-gc', vitest, 'run', 'tests/dpiBenchmarkRunner.test.ts',
          '--reporter=dot', '--pool=forks', '--maxWorkers=1',
        ], {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 240_000,
          killSignal: 'SIGKILL',
          env: {
            ...process.env,
            ANONIMATOR_DPI_BENCH_CHILD: '1',
            ANONIMATOR_DPI_BENCH_DPI: String(ocrDpi),
            ANONIMATOR_DPI_BENCH_FIXTURE: fixture.id,
            ANONIMATOR_DPI_BENCH_RESULT: resultFile,
            ANONIMATOR_DPI_BENCH_USER_DATA: dirname(dirname(trainedData)),
          },
        })
        if (child.error || child.signal || child.status !== 0 || !existsSync(resultFile)) {
          throw new Error(child.error?.code === 'ETIMEDOUT' || child.signal ? 'DPI_BENCH_CHILD_TIMEOUT' : 'DPI_BENCH_CHILD_FAILED')
        }
        let run
        try { run = JSON.parse(readFileSync(resultFile, 'utf8')) } catch { throw new Error('DPI_BENCH_CHILD_SCHEMA_INVALID') }
        if (!validRun(run, fixture, ocrDpi)) throw new Error('DPI_BENCH_CHILD_SCHEMA_INVALID')
        runs.push(run)
      }
    }

    const expectedRuns = FIXTURES.length * DPIS.length * repetitions
    if (runs.length !== expectedRuns) throw new Error('DPI_BENCH_MATRIX_INCOMPLETE')
    const results = FIXTURES.flatMap((fixture) => DPIS.map((ocrDpi) => {
      const matching = runs.filter((run) => run.fixture === fixture.id && run.ocrDpi === ocrDpi)
      if (matching.length !== repetitions) throw new Error('DPI_BENCH_MATRIX_INCOHERENT')
      return aggregate(fixture, ocrDpi, matching)
    }))
    const candidates = DPIS.map((ocrDpi) => ({
      ocrDpi,
      acceptancePassed: results.filter((result) => result.ocrDpi === ocrDpi)
        .every((result) => result.acceptancePassed),
    }))
    const report = {
      schemaVersion: 2,
      corpus: 'synthetic-dpi-matrix-v2',
      repetitions,
      ocrDpiCandidates: DPIS,
      sourceDpiScenarios: [...new Set(FIXTURES.map((fixture) => fixture.sourceDpi))],
      outputRasterMetric: 'source-native-independent-of-ocr-dpi',
      acceptancePolicy: {
        invariant: 'sensitiveRecall=1; complete=1; matchedTargets=targetCount; centerErrorPt<=4',
        clean: 'tokenRecall>=0.98; CER<=0.02',
        small7pt: 'tokenRecall>=0.90; CER<=0.08',
        degraded150dpi: 'tokenRecall>=0.85; CER<=0.12',
      },
      candidates,
      results,
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!candidates.find((candidate) => candidate.ocrDpi === 300)?.acceptancePassed) {
      process.stderr.write('DPI_BENCH_BASELINE_GATE_FAILED\n')
      process.exitCode = 2
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  const code = error instanceof Error && /^DPI_BENCH_[A-Z_]+$/.test(error.message)
    ? error.message
    : 'DPI_BENCH_FAILED'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
}
