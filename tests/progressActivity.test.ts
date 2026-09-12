import { describe, expect, it } from 'vitest'
import { getProgressActivityPresentation } from '../src/renderer/src/utils/progressActivity'

describe('getProgressActivityPresentation', () => {
  it.each([
    ['parsing', 'document', 'Lettura documento'],
    ['ocr', 'ocr', 'Riconoscimento testo'],
    ['ner', 'entities', 'Rilevamento entità'],
    ['output', 'output', 'Anonimizzazione documento'],
    ['done', 'complete', 'Elaborazione completata'],
  ] as const)('maps %s to the matching activity icon semantics', (stage, activity, label) => {
    expect(getProgressActivityPresentation(stage)).toEqual({ activity, label })
  })
})
