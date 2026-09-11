import type { EntityType } from '@shared/types'
import type { Rect } from './geometry'

export interface MatchableEntity {
  entityId: string
  type: EntityType
  originalText: string
}

export interface MatchWord {
  text: string
  bbox: Rect
  /** Identificatore opzionale della riga OCR; i match possono attraversare righe. */
  line?: number
}

export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous' | 'rejected'

export interface EntityMatchOutcome {
  entityId: string
  page: number
  wordStart: number | null
  /** Indice incluso. */
  wordEnd: number | null
  box: Rect | null
  status: MatchStatus
}

export interface MatcherOptions {
  /** Zero-based page index. */
  page: number
  /** Limite difensivo al numero di parole considerate per singolo candidato. */
  maxWordsPerCandidate?: number
  /** Un rettangolo non accettato rimane nel ledger con stato `rejected`. */
  acceptRect?: (rect: Rect) => boolean
}

const EXACT_ONLY_TYPES: ReadonlySet<EntityType> = new Set([
  'CODICE_FISCALE',
  'IBAN',
  'NUMERO_DOCUMENTO',
  'TARGA'
])

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu
const TRAILING_HYPHEN = /[-\u00ad\u058a\u2010\u2011\u2012\u2013]$/u

function normalizePart(value: string): string {
  return value
    .normalize('NFKC')
    .replace(EDGE_PUNCTUATION, '')
    .toLocaleUpperCase('it-IT')
    .replace(/\s+/gu, ' ')
    .trim()
}

function matchKey(value: string, type: EntityType): string {
  const normalized = normalizePart(value)
  return EXACT_ONLY_TYPES.has(type) ? normalized.replace(/\s+/gu, '') : normalized
}

function hasValidRect(rect: Rect): boolean {
  return [rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite)
    && rect.x1 > rect.x0
    && rect.y1 > rect.y0
}

function unionRect(words: readonly MatchWord[], start: number, end: number): Rect | null {
  const boxes = words.slice(start, end + 1).map(({ bbox }) => bbox)
  if (boxes.length === 0 || boxes.some((box) => !hasValidRect(box))) return null
  return {
    x0: Math.min(...boxes.map(({ x0 }) => x0)),
    y0: Math.min(...boxes.map(({ y0 }) => y0)),
    x1: Math.max(...boxes.map(({ x1 }) => x1)),
    y1: Math.max(...boxes.map(({ y1 }) => y1))
  }
}

function rangesOverlap(left: EntityMatchOutcome, right: EntityMatchOutcome): boolean {
  if (left.wordStart === null || left.wordEnd === null || right.wordStart === null || right.wordEnd === null) {
    return false
  }
  return left.wordStart <= right.wordEnd && right.wordStart <= left.wordEnd
}

function makePhrase(
  words: readonly MatchWord[],
  start: number,
  end: number
): string {
  let phrase = ''
  let joinWithoutSpace = false
  for (let index = start; index <= end; index++) {
    const raw = words[index].text.normalize('NFKC').trim()
    if (!raw) continue
    const isHyphenatedBreak = TRAILING_HYPHEN.test(raw)
    const withoutBreakHyphen = isHyphenatedBreak ? raw.replace(TRAILING_HYPHEN, '') : raw
    const part = normalizePart(withoutBreakHyphen)
    if (part) phrase += phrase && !joinWithoutSpace ? ` ${part}` : part
    joinWithoutSpace = isHyphenatedBreak
  }
  return phrase
}

/**
 * Matcher deterministico: applica soltanto equivalenze Unicode/di layout, mai
 * distanza di edit o sostituzioni fuzzy. Questo rende necessariamente exact-only
 * CF, IBAN, documenti e targhe e mantiene prudente anche il resto del ledger.
 */
export function matchEntitiesOnPage(
  words: readonly MatchWord[],
  entities: readonly MatchableEntity[],
  options: MatcherOptions
): EntityMatchOutcome[] {
  const page = options.page
  if (!Number.isInteger(page) || page < 0) throw new RangeError('page must be a non-negative integer')
  const maxWords = options.maxWordsPerCandidate ?? 64
  if (!Number.isInteger(maxWords) || maxWords < 1) throw new RangeError('maxWordsPerCandidate must be positive')

  const outcomes: EntityMatchOutcome[] = []
  for (const entity of entities) {
    const target = matchKey(entity.originalText, entity.type)
    let found = false
    if (target) {
      for (let start = 0; start < words.length; start++) {
        for (let end = start; end < words.length && end - start < maxWords; end++) {
          const candidate = matchKey(makePhrase(words, start, end), entity.type)
          if (!candidate) continue
          if (candidate === target) {
            found = true
            const box = unionRect(words, start, end)
            const accepted = box !== null && (options.acceptRect?.(box) ?? true)
            outcomes.push({
              entityId: entity.entityId,
              page,
              wordStart: start,
              wordEnd: end,
              box,
              status: accepted ? 'matched' : 'rejected'
            })
            break
          }
          // Tutte le normalizzazioni usate dalla chiave non riducono mai la stringa
          // già accumulata; superata la lunghezza target non potrà più coincidere.
          if (candidate.length > target.length) break
        }
      }
    }
    if (!found) {
      outcomes.push({
        entityId: entity.entityId,
        page,
        wordStart: null,
        wordEnd: null,
        box: null,
        status: 'unmatched'
      })
    }
  }

  // Candidati appartenenti a entità diverse che reclamano almeno una stessa parola
  // sono incompatibili. Nessuna precedenza implicita: entrambi diventano ambiguous.
  for (let left = 0; left < outcomes.length; left++) {
    if (outcomes[left].status !== 'matched' && outcomes[left].status !== 'ambiguous') continue
    for (let right = left + 1; right < outcomes.length; right++) {
      if (outcomes[right].status !== 'matched' && outcomes[right].status !== 'ambiguous') continue
      if (outcomes[left].entityId === outcomes[right].entityId) continue
      if (rangesOverlap(outcomes[left], outcomes[right])) {
        outcomes[left].status = 'ambiguous'
        outcomes[right].status = 'ambiguous'
      }
    }
  }

  return outcomes
}
