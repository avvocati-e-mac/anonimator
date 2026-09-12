import type { ProcessingProgress } from '@shared/types'

export type ProgressActivity = 'document' | 'ocr' | 'entities' | 'output' | 'complete'

export interface ProgressActivityPresentation {
  activity: ProgressActivity
  label: string
}

export function getProgressActivityPresentation(
  stage: ProcessingProgress['stage']
): ProgressActivityPresentation {
  switch (stage) {
    case 'parsing':
      return { activity: 'document', label: 'Lettura documento' }
    case 'ocr':
      return { activity: 'ocr', label: 'Riconoscimento testo' }
    case 'ner':
      return { activity: 'entities', label: 'Rilevamento entità' }
    case 'output':
      return { activity: 'output', label: 'Anonimizzazione documento' }
    case 'done':
      return { activity: 'complete', label: 'Elaborazione completata' }
  }
}
