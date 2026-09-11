import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/anonimator-ner-integration-no-model' },
}))

vi.mock('../src/main/services/llmService', () => ({
  detectNamesWithLlm: vi.fn().mockResolvedValue([]),
}))

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockRejectedValue(new Error('model intentionally unavailable')),
  env: {
    allowRemoteModels: false,
    allowLocalModels: true,
    localModelPath: '',
    backends: { onnx: { wasm: {} } },
  },
}))

import {
  analyzeText,
  firstDefinedCapture,
  resetNerPipeline,
  setStrictCF,
} from '../src/main/services/nerService'
import { NER_RECALL_CORPUS } from './fixtures/nerRecallCorpus'

describe('analyzeText — integrazione regex v1.8', () => {
  beforeEach(() => {
    setStrictCF(false)
    resetNerPipeline()
  })

  it('estrae il primo capture definito anche oltre il secondo gruppo', () => {
    const pattern = /prima:\s+(\w+)|seconda:\s+(\w+)|terza:\s+(\w+)/g
    const match = [...'terza: valore'.matchAll(pattern)][0]
    expect(firstDefinedCapture(match)).toBe('valore')
  })

  it('estrae solo il numero documento dal terzo ramo alternativo', async () => {
    const result = await analyzeText('C.I. rilasciata il 10/03/2021 con n. CA 5528847')
    const documents = result.entities.filter((entity) => entity.type === 'NUMERO_DOCUMENTO')
    expect(documents).toHaveLength(1)
    expect(documents[0].originalText).toBe('CA 5528847')
  })

  it('ammette singoli token PERSONA soltanto nei campi Cognome/Nome', async () => {
    const result = await analyzeText('Cognome: Neri\nNome: Luca\nRuolo: addetto')
    const people = result.entities
      .filter((entity) => entity.type === 'PERSONA')
      .map((entity) => entity.originalText)
    expect(people).toEqual(expect.arrayContaining(['Neri', 'Luca']))
    expect(people).not.toContain('addetto')
  })

  it('non produce il prefisso telefonico invece del numero completo', async () => {
    const result = await analyzeText('Telefono: +39 333 I234567')
    expect(result.entities).toContainEqual(expect.objectContaining({
      type: 'TELEFONO',
      originalText: '+39 333 I234567',
    }))
  })

  it('non duplica un indirizzo completo di CAP con il pattern senza CAP', async () => {
    const result = await analyzeText('residente in Via del Gelsomino 12, 00123.')
    expect(result.entities.filter((entity) => entity.type === 'INDIRIZZO')).toHaveLength(1)
  })

  it('non classifica identificativi ambigui privi del loro contesto', async () => {
    const result = await analyzeText(
      'Numero di protocollo amministrativo: 12345678901.\n' +
      'Codice interno della pratica: AB 123 CD.'
    )
    expect(result.entities.filter((entity) =>
      entity.type === 'PARTITA_IVA' || entity.type === 'TARGA'
    )).toHaveLength(0)
  })

  it('lascia opzionale il datore di lavoro rilevato come organizzazione', async () => {
    const result = await analyzeText('Datore di lavoro: Officina Gamma S.r.l.')
    expect(result.entities).toContainEqual(expect.objectContaining({
      type: 'ORGANIZZAZIONE',
      originalText: 'Officina Gamma S.r.l.',
      confirmed: false,
    }))
  })

  it.each(NER_RECALL_CORPUS)('coincide esattamente col gold sintetico: $id', async (sample) => {
    const result = await analyzeText(sample.text)
    const actual = result.entities
      .map(({ type, originalText }) => `${type}\u0000${originalText}`)
      .sort()
    const expected = sample.expected
      .map(({ type, originalText }) => `${type}\u0000${originalText}`)
      .sort()
    expect(actual).toEqual(expected)
  })
})
