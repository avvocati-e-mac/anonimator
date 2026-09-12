import React from 'react'
import {
  BrainCircuit,
  CircleCheckBig,
  FileLock2,
  FileSearch,
  Loader2,
  ScanText,
} from 'lucide-react'
import type { ProcessingProgress } from '@shared/types'
import {
  getProgressActivityPresentation,
  type ProgressActivity,
} from '../utils/progressActivity'

interface ProgressActivityIconProps {
  stage: ProcessingProgress['stage']
}

const activityStyles: Record<ProgressActivity, string> = {
  document: 'text-sky-600 dark:text-sky-400',
  ocr: 'text-violet-600 dark:text-violet-400',
  entities: 'text-amber-600 dark:text-amber-400',
  output: 'text-blue-600 dark:text-blue-400',
  complete: 'text-emerald-600 dark:text-emerald-400',
}

function ActivityGlyph({ activity }: { activity: ProgressActivity }): React.JSX.Element {
  const className = activityStyles[activity]

  switch (activity) {
    case 'document':
      return <FileSearch size={56} className={className} aria-hidden="true" />
    case 'ocr':
      return <ScanText size={56} className={className} aria-hidden="true" />
    case 'entities':
      return <BrainCircuit size={56} className={className} aria-hidden="true" />
    case 'output':
      return <FileLock2 size={56} className={className} aria-hidden="true" />
    case 'complete':
      return <CircleCheckBig size={56} className={className} aria-hidden="true" />
  }
}

export default function ProgressActivityIcon({ stage }: ProgressActivityIconProps): React.JSX.Element {
  const presentation = getProgressActivityPresentation(stage)
  const isComplete = presentation.activity === 'complete'

  return (
    <div className="relative" role="img" aria-label={presentation.label}>
      <ActivityGlyph activity={presentation.activity} />
      {!isComplete && (
        <Loader2
          size={24}
          className="absolute -bottom-1 -right-1 text-blue-400 animate-spin"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
