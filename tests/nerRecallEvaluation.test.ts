import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EntityType } from '../src/shared/types'
import { NER_RECALL_CORPUS } from './fixtures/nerRecallCorpus'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/anonimator-synthetic-no-model' },
}))

vi.mock('../src/main/services/llmService', () => ({
  detectNamesWithLlm: vi.fn().mockResolvedValue([]),
}))

// La factory fallisce intenzionalmente: l'evaluation attraversa analyzeText e
// tutta la regex di produzione, senza file ONNX, rete o inferenza simulata.
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockRejectedValue(new Error('no model in synthetic evaluation')),
  env: {
    allowRemoteModels: false,
    allowLocalModels: true,
    localModelPath: '',
    backends: { onnx: { wasm: {} } },
  },
}))

import { analyzeText, resetNerPipeline, setStrictCF } from '../src/main/services/nerService'

interface Counts {
  tp: number
  fp: number
  fn: number
}

interface Metrics extends Counts {
  precision: number
  recall: number
  f1: number
}

interface EvaluationReport {
  cases: number
  positiveCases: number
  negativeControls: number
  negativeControlFalsePositives: number
  byType: Partial<Record<EntityType, Metrics>>
  micro: Metrics
  macro: Pick<Metrics, 'precision' | 'recall' | 'f1'>
}

const EMPTY_COUNTS: Counts = { tp: 0, fp: 0, fn: 0 }

/** Baseline misurata su v1.7 prima delle correzioni recall. */
const PRE_FIX_BASELINE = {
  micro: {
    precision: 2 / 3,
    recall: 12 / 26,
    f1: 6 / 11,
    falsePositives: 6,
  },
  macro: {
    recall: 0.5466666666666666,
    f1: 0.4686274509803921,
  },
} as const

/** Target minimo v1.8 sul corpus congelato; resta inferiore al risultato perfetto corrente. */
const POST_FIX_TARGET = {
  microPrecision: 0.95,
  microRecall: 0.95,
  microF1: 0.95,
  macroRecall: 0.9,
  macroF1: 0.9,
} as const

function exactKey(type: EntityType, originalText: string): string {
  return `${type}\u0000${originalText}`
}

function metrics(counts: Counts): Metrics {
  const precision = counts.tp + counts.fp === 0 ? 1 : counts.tp / (counts.tp + counts.fp)
  const recall = counts.tp + counts.fn === 0 ? 1 : counts.tp / (counts.tp + counts.fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { ...counts, precision, recall, f1 }
}

function addCounts(target: Counts, source: Counts): void {
  target.tp += source.tp
  target.fp += source.fp
  target.fn += source.fn
}

async function evaluateCorpus(): Promise<EvaluationReport> {
  const aggregate = new Map<EntityType, Counts>()
  let negativeControlFalsePositives = 0

  for (const sample of NER_RECALL_CORPUS) {
    const result = await analyzeText(sample.text)
    const predicted = new Map<string, { type: EntityType; occurrences: number }>()
    const expected = new Map<string, { type: EntityType; occurrences: number }>()

    for (const entity of result.entities) {
      // Ogni previsione deve essere direttamente cercabile nel testo: niente
      // normalizzazione fuzzy nell'evaluator exact-match.
      expect(sample.text.includes(entity.originalText)).toBe(true)
      const key = exactKey(entity.type, entity.originalText)
      const previous = predicted.get(key)
      predicted.set(key, {
        type: entity.type,
        occurrences: (previous?.occurrences ?? 0) + entity.occurrences,
      })
    }
    for (const entity of sample.expected) {
      expected.set(exactKey(entity.type, entity.originalText), {
        type: entity.type,
        occurrences: entity.occurrences,
      })
    }

    if (sample.category === 'negative-control') {
      negativeControlFalsePositives += [...predicted.values()]
        .reduce((sum, entity) => sum + entity.occurrences, 0)
    }

    const keys = new Set([...expected.keys(), ...predicted.keys()])
    for (const key of keys) {
      const gold = expected.get(key)
      const guess = predicted.get(key)
      const type = gold?.type ?? guess?.type
      if (type === undefined) continue
      const goldOccurrences = gold?.occurrences ?? 0
      const predictedOccurrences = guess?.occurrences ?? 0
      const tp = Math.min(goldOccurrences, predictedOccurrences)
      const counts = aggregate.get(type) ?? { ...EMPTY_COUNTS }
      counts.tp += tp
      counts.fn += goldOccurrences - tp
      counts.fp += predictedOccurrences - tp
      aggregate.set(type, counts)
    }
  }

  const microCounts: Counts = { ...EMPTY_COUNTS }
  const byType: Partial<Record<EntityType, Metrics>> = {}
  for (const [type, counts] of aggregate) {
    addCounts(microCounts, counts)
    byType[type] = metrics(counts)
  }

  const activeMetrics = Object.values(byType)
  const macro = activeMetrics.length === 0
    ? { precision: 1, recall: 1, f1: 1 }
    : {
        precision: activeMetrics.reduce((sum, value) => sum + value.precision, 0) / activeMetrics.length,
        recall: activeMetrics.reduce((sum, value) => sum + value.recall, 0) / activeMetrics.length,
        f1: activeMetrics.reduce((sum, value) => sum + value.f1, 0) / activeMetrics.length,
      }

  return {
    cases: NER_RECALL_CORPUS.length,
    positiveCases: NER_RECALL_CORPUS.filter((sample) => sample.expected.length > 0).length,
    negativeControls: NER_RECALL_CORPUS.filter((sample) => sample.category === 'negative-control').length,
    negativeControlFalsePositives,
    byType,
    micro: metrics(microCounts),
    macro,
  }
}

describe('NER recall — corpus sintetico occurrence-aware', () => {
  let report: EvaluationReport

  beforeAll(async () => {
    setStrictCF(false)
    resetNerPipeline()
    report = await evaluateCorpus()
  })

  it('copre casi positivi, varianti OCR e controlli negativi', () => {
    expect(report.cases).toBeGreaterThanOrEqual(20)
    expect(report.positiveCases).toBeGreaterThanOrEqual(15)
    expect(report.negativeControls).toBeGreaterThanOrEqual(5)
    expect(NER_RECALL_CORPUS
      .filter((sample) => sample.category === 'negative-control')
      .every((sample) => sample.expected.length === 0)).toBe(true)
    expect(Object.keys(report.byType).length).toBeGreaterThanOrEqual(8)
  })

  it('non regredisce rispetto alla baseline v1.7 pre-fix', () => {
    expect(report.micro.precision).toBeGreaterThanOrEqual(PRE_FIX_BASELINE.micro.precision)
    expect(report.micro.recall).toBeGreaterThanOrEqual(PRE_FIX_BASELINE.micro.recall)
    expect(report.micro.f1).toBeGreaterThanOrEqual(PRE_FIX_BASELINE.micro.f1)
    expect(report.micro.fp).toBeLessThanOrEqual(PRE_FIX_BASELINE.micro.falsePositives)
    expect(report.macro.recall).toBeGreaterThanOrEqual(PRE_FIX_BASELINE.macro.recall)
    expect(report.macro.f1).toBeGreaterThanOrEqual(PRE_FIX_BASELINE.macro.f1)
  })

  it('raggiunge il target post-fix e non produce falsi positivi sui controlli negativi', () => {
    expect(report.micro.precision).toBeGreaterThanOrEqual(POST_FIX_TARGET.microPrecision)
    expect(report.micro.recall).toBeGreaterThanOrEqual(POST_FIX_TARGET.microRecall)
    expect(report.micro.f1).toBeGreaterThanOrEqual(POST_FIX_TARGET.microF1)
    expect(report.macro.recall).toBeGreaterThanOrEqual(POST_FIX_TARGET.macroRecall)
    expect(report.macro.f1).toBeGreaterThanOrEqual(POST_FIX_TARGET.macroF1)
    expect(report.negativeControlFalsePositives).toBe(0)
  })

  it('espone solo il report aggregato dell\'evaluation', () => {
    const aggregateOnly = {
      cases: report.cases,
      positiveCases: report.positiveCases,
      negativeControls: report.negativeControls,
      negativeControlFalsePositives: report.negativeControlFalsePositives,
      byType: report.byType,
      micro: report.micro,
      macro: report.macro,
    }
    console.info(`NER_RECALL_EVALUATION ${JSON.stringify(aggregateOnly)}`)
    expect(report.micro.tp + report.micro.fn).toBeGreaterThan(0)
  })
})
