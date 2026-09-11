import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EntityType } from '../src/shared/types'
import { NER_RECALL_CORPUS } from './fixtures/nerRecallCorpus'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/anonimator-synthetic-no-model' },
}))

vi.mock('../src/main/services/llmService', () => ({
  detectNamesWithLlm: vi.fn().mockResolvedValue([]),
}))

// La factory fallisce intenzionalmente: la baseline attraversa analyzeText e
// tutta la regex di produzione, senza file ONNX, rete o inferenza simulata.
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockRejectedValue(new Error('no model in synthetic baseline')),
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
  byType: Partial<Record<EntityType, Metrics>>
  micro: Metrics
  macro: Pick<Metrics, 'precision' | 'recall' | 'f1'>
}

const EMPTY_COUNTS: Counts = { tp: 0, fp: 0, fn: 0 }

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
    expect(Object.keys(report.byType).length).toBeGreaterThanOrEqual(8)
  })

  it('mantiene un budget esplicito sui falsi positivi deterministici', () => {
    // Baseline v1.7 pre-fix: precisione 2/3 e sei occorrenze false-positive.
    // I fix v1.8 possono migliorare entrambi i valori, mai peggiorarli.
    expect(report.micro.precision).toBeGreaterThanOrEqual(2 / 3)
    expect(report.micro.fp).toBeLessThanOrEqual(6)
  })

  it('espone solo il report aggregato della baseline pre-fix', () => {
    const aggregateOnly = {
      cases: report.cases,
      positiveCases: report.positiveCases,
      negativeControls: report.negativeControls,
      byType: report.byType,
      micro: report.micro,
      macro: report.macro,
    }
    console.info(`NER_RECALL_BASELINE ${JSON.stringify(aggregateOnly)}`)
    expect(report.micro.tp + report.micro.fn).toBeGreaterThan(0)
  })
})
