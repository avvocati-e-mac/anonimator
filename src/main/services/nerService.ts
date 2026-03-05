import { pipeline, env } from '@huggingface/transformers'
import type {
  TokenClassificationSingle,
  TokenClassificationOutput
} from '@huggingface/transformers'

// Tipo funzionale del pipeline NER — evita la union type troppo complessa di Transformers.js
type NerPipelineFn = (text: string) => Promise<TokenClassificationOutput | TokenClassificationOutput[]>
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log'
import type { DetectedEntity, EntityType } from '@shared/types'

// ─── Configurazione Transformers.js ──────────────────────────────────────────
// Disabilita qualunque tentativo di download dalla rete
env.allowRemoteModels = false
env.allowLocalModels = true

// ─── Regex per dati strutturati italiani ─────────────────────────────────────
const REGEX_PATTERNS: { type: EntityType; pattern: RegExp }[] = [
  {
    type: 'CODICE_FISCALE',
    pattern: /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi
  },
  {
    type: 'PARTITA_IVA',
    pattern: /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi
  },
  {
    type: 'IBAN',
    pattern: /\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi
  },
  {
    type: 'TELEFONO',
    pattern: /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g
  }
]

// ─── Mapping etichette modello → EntityType interno ───────────────────────────
// Laibniz/italian-ner-pii-browser-distilbert produce etichette semplici (no BIO):
// PER → PERSONA, LOC → LUOGO, ORG → ORGANIZZAZIONE, MISC → ignorato
const LABEL_TO_ENTITY_TYPE: Record<string, EntityType> = {
  PER: 'PERSONA',
  LOC: 'LUOGO',
  ORG: 'ORGANIZZAZIONE'
  // MISC ignorato: troppo generico
}

/** Normalizza etichetta: rimuove eventuale prefisso B-/I- (robustezza) */
function normalizeLabel(label: string): string {
  return label.replace(/^[BI]-/, '').toUpperCase()
}

// ─── Singleton pipeline NER ───────────────────────────────────────────────────
let nerPipeline: NerPipelineFn | null = null
let modelLoadFailed = false

async function getNerPipeline(): Promise<NerPipelineFn | null> {
  if (nerPipeline) return nerPipeline
  if (modelLoadFailed) return null

  try {
    const modelPath = join(app.getAppPath(), 'resources', 'models', 'italian-ner-xxl-v2')
    log.info('Caricamento modello NER...', { path: modelPath })
    const startMs = Date.now()

    nerPipeline = await pipeline('token-classification', modelPath, {
      local_files_only: true
    }) as unknown as NerPipelineFn

    log.info('Modello NER caricato', { ms: Date.now() - startMs })
    return nerPipeline
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('Modello NER non disponibile, fallback a sole regex', { error: message })
    modelLoadFailed = true
    return null
  }
}

// ─── Helper: costruisce DetectedEntity senza pseudonimo ──────────────────────
function buildEntity(originalText: string, type: EntityType): DetectedEntity {
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    originalText,
    pseudonym: '', // assegnato da sessionManager.enrichEntities()
    occurrences: 0,
    confirmed: true
  }
}

// ─── Conta occorrenze ─────────────────────────────────────────────────────────
function countOccurrences(text: string, entityText: string): number {
  const escaped = entityText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(escaped, 'gi')) ?? []).length
}

// ─── Post-processing output BIO: aggrega token consecutivi della stessa entità ─
interface AggregatedEntity {
  word: string
  label: string
  score: number
}

function aggregateBioTokens(items: TokenClassificationSingle[]): AggregatedEntity[] {
  const aggregated: AggregatedEntity[] = []
  let current: AggregatedEntity | null = null

  // Limite parole per entità: nessun nome/luogo/org reale supera 5 parole
  const MAX_WORDS = 5

  for (const item of items) {
    const normalized = normalizeLabel(item.entity)
    if (normalized === 'O') { if (current) { aggregated.push(current); current = null } continue }

    const isWordPieceContinuation = item.word.startsWith('##')
    const isSameEntity = current && current.label === normalized && !item.entity.startsWith('B-')
    const currentWordCount = current ? current.word.split(' ').length : 0

    if (isWordPieceContinuation && current) {
      // Subword token: concatena senza spazio
      current.word += item.word.replace(/^##/, '')
      current.score = Math.min(current.score, item.score)
    } else if (isSameEntity && currentWordCount < MAX_WORDS) {
      // Stesso tipo, token continuazione entro limite parole: concatena con spazio
      current!.word += ' ' + item.word
      current!.score = Math.min(current!.score, item.score)
    } else {
      // Nuova entità (o entità corrente troppo lunga → la chiude e ne apre una nuova)
      if (current) aggregated.push(current)
      current = { word: item.word, label: normalized, score: item.score }
    }
  }
  if (current) aggregated.push(current)

  return aggregated
}

// ─── Analisi principale ───────────────────────────────────────────────────────

export interface NerAnalysisResult {
  entities: DetectedEntity[]
  nerUsed: boolean
  warnings: string[]
}

export async function analyzeText(text: string): Promise<NerAnalysisResult> {
  const warnings: string[] = []
  const foundTexts = new Set<string>()
  let allEntities: DetectedEntity[] = []
  let nerUsed = false

  // 1. Regex — veloci, deterministiche, sempre eseguite
  for (const { type, pattern } of REGEX_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[0]).trim()
      if (!raw || foundTexts.has(raw.toLowerCase())) continue
      foundTexts.add(raw.toLowerCase())
      allEntities.push(buildEntity(raw, type))
    }
  }

  // 2. NER con modello BERT (se disponibile)
  const pipe = await getNerPipeline()
  if (pipe) {
    try {
      const chunks = splitTextIntoChunks(text, 400)
      for (const chunk of chunks) {
        const raw = await pipe(chunk) as TokenClassificationOutput | TokenClassificationOutput[]
        // Normalizza: il risultato può essere array piatto o array di array (batch)
        const flat: TokenClassificationSingle[] = Array.isArray(raw[0])
          ? (raw as TokenClassificationOutput[]).flat()
          : (raw as TokenClassificationOutput)

        const aggregated = aggregateBioTokens(flat)

        for (const { word, label, score } of aggregated) {
          if (score < 0.60) continue
          const entityType = LABEL_TO_ENTITY_TYPE[label]
          if (!entityType) continue
          const cleaned = word.trim().replace(/^#+/, '')
          if (cleaned.length < 2 || foundTexts.has(cleaned.toLowerCase())) continue
          foundTexts.add(cleaned.toLowerCase())
          allEntities.push(buildEntity(cleaned, entityType))
        }
      }
      nerUsed = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('Errore durante inferenza NER', { error: message })
      warnings.push('Riconoscimento automatico nomi parziale. Verificare manualmente.')
    }
  } else {
    warnings.push('Modello NER non disponibile. Solo dati strutturati (CF, IBAN, ecc.) rilevati automaticamente.')
  }

  // 3. Cerca varianti maiuscole delle entità NER trovate
  //    Es. se NER trova "Mario Rossi", cerca anche "MARIO ROSSI" nel testo del PDF
  //    (utile per intestazioni in maiuscolo nei documenti legali)
  const nerTypes = new Set<EntityType>(['PERSONA', 'ORGANIZZAZIONE', 'LUOGO'])
  const nerEntities = allEntities.filter((e) => nerTypes.has(e.type))
  for (const entity of nerEntities) {
    const upperVariant = entity.originalText.toUpperCase()
    if (upperVariant !== entity.originalText && !foundTexts.has(upperVariant.toLowerCase())) {
      const escaped = upperVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`).test(text)) {
        foundTexts.add(upperVariant.toLowerCase())
        allEntities.push({ ...buildEntity(upperVariant, entity.type), pseudonym: entity.pseudonym })
      }
    }
  }

  // 4. Conta occorrenze
  for (const entity of allEntities) {
    entity.occurrences = countOccurrences(text, entity.originalText)
  }

  // 5. Rimuovi entità NER rumorose: scarta quelle più lunghe che contengono
  //    come sottostringa un'entità più corta della stessa categoria.
  allEntities = allEntities.filter((entity) => {
    if (entity.occurrences === 0) return false
    if (!nerTypes.has(entity.type)) return true // mai scartare entità regex
    const shorter = allEntities.filter(
      (e) => e !== entity && e.type === entity.type && e.originalText.length < entity.originalText.length
    )
    const containsShorter = shorter.some((e) =>
      entity.originalText.toLowerCase().includes(e.originalText.toLowerCase())
    )
    return !containsShorter
  })

  // 6. Ordina per occorrenze decrescenti
  allEntities.sort((a, b) => b.occurrences - a.occurrences)

  log.info('Analisi NER completata', {
    totalEntities: allEntities.length,
    nerUsed,
    warnings: warnings.length
  })

  return { entities: allEntities, nerUsed, warnings }
}

function splitTextIntoChunks(text: string, targetWords: number): string[] {
  const words = text.split(/\s+/)
  if (words.length <= targetWords) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    let end = Math.min(start + targetWords, words.length)
    if (end < words.length) {
      for (let i = end; i > end - 20 && i > start; i--) {
        if (/[.?!]$/.test(words[i - 1])) { end = i; break }
      }
    }
    chunks.push(words.slice(start, end).join(' '))
    start = end
  }

  return chunks
}
