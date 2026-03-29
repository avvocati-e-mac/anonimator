import type {
  TokenClassificationSingle,
  TokenClassificationOutput
} from '@huggingface/transformers'

// Tipo funzionale del pipeline NER
type NerPipelineFn = (text: string) => Promise<TokenClassificationOutput | TokenClassificationOutput[]>
type TransformersPipelineFn = typeof import('@huggingface/transformers').pipeline

import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log'
import type { DetectedEntity, EntityType, LlmConfig } from '@shared/types'
import { DEFAULT_LLM_CONFIG } from '@shared/types'
import { inferChunkSize } from '@shared/modelSizeUtils'
import { detectNamesWithLlm } from './llmService'
import { sessionManager } from './sessionManager'
import {
  SENTENCE_HEADER_PATTERN,
  STRUCTURED_LEGAL_PATTERNS,
  AVV_LISTA_PATTERN,
  PKI_FIRMA_PATTERN,
  REGEX_PATTERNS,
  CODICE_FISCALE_PATTERN_LENIENT,
  CODICE_FISCALE_PATTERN_STRICT,
} from './regexPatterns'
import { LEGAL_STOP_WORDS } from './legalStopWords'

// Flag per la validazione strict del Codice Fiscale.
// Default: false — perché l'OCR può distorcere lettere (B→8, O→0),
// rendendo validi CF illeggibili col pattern strict.
// Impostare a true solo su documenti nativi (non OCR) per ridurre falsi positivi.
let _strictCF = false

export function setStrictCF(value: boolean): void {
  _strictCF = value
}

export function getStrictCF(): boolean {
  return _strictCF
}

function getCFPattern(): RegExp {
  return _strictCF ? CODICE_FISCALE_PATTERN_STRICT : CODICE_FISCALE_PATTERN_LENIENT
}

let _pipelineFactory: TransformersPipelineFn | null = null
let _transformersLoadAttempted = false

async function tryLoadTransformers(): Promise<TransformersPipelineFn | null> {
  if (_transformersLoadAttempted) return _pipelineFactory
  _transformersLoadAttempted = true
  try {
    log.info('Caricamento Transformers.js v3...')
    const mod = await import('@huggingface/transformers')
    
    // Configurazione Transformers.js per ambiente offline/local
    mod.env.allowRemoteModels = false
    mod.env.allowLocalModels = true
    const modelPath = getModelPath()
    mod.env.localModelPath = modelPath

    // FIX per Electron: disabilita proxy worker che fallirebbe in ambiente Node
    if (mod.env?.backends?.onnx?.wasm) {
      (mod.env.backends.onnx.wasm as any).proxy = false
    }

    // Diagnostica onnxruntime-node
    try {
      const ort = require('onnxruntime-node')
      log.info('onnxruntime-node caricato', { version: (ort as any).version, hasInferenceSession: !!(ort as any).InferenceSession })
    } catch (err) {
      log.warn('onnxruntime-node non caricabile via require, Transformers.js userà il fallback', { 
        error: err instanceof Error ? err.message : String(err) 
      })
    }

    log.info('Transformers.js caricato correttamente')
    _pipelineFactory = mod.pipeline as TransformersPipelineFn
    return _pipelineFactory
  } catch (err) {
    log.error('Errore fatale caricamento Transformers.js', {
      error: err instanceof Error ? err.stack : String(err)
    })
    return null
  }
}

// ─── Cache NER per chunk identici in sessioni multi-documento ───────────────
// Chiave: SHA-256 del testo del chunk (hash — il testo in chiaro non è recuperabile).
// Massimo 200 entry: LRU semplice (cancella la più vecchia se piena).
// La cache è in RAM — viene persa al riavvio dell'app. Non persistere su disco.
const nerChunkCache = new Map<string, DetectedEntity[]>()
const NER_CACHE_MAX_SIZE = 200

function getCachedChunkEntities(chunkText: string): DetectedEntity[] | undefined {
  const crypto = require('crypto') as typeof import('crypto')
  const hash = crypto.createHash('sha256').update(chunkText).digest('hex')
  return nerChunkCache.get(hash)
}

function setCachedChunkEntities(chunkText: string, entities: DetectedEntity[]): void {
  const crypto = require('crypto') as typeof import('crypto')
  const hash = crypto.createHash('sha256').update(chunkText).digest('hex')
  if (nerChunkCache.size >= NER_CACHE_MAX_SIZE) {
    // LRU semplice: cancella la prima entry (la più vecchia)
    const firstKey = nerChunkCache.keys().next().value
    if (firstKey !== undefined) nerChunkCache.delete(firstKey)
  }
  nerChunkCache.set(hash, entities)
}

export function clearNerChunkCache(): void {
  nerChunkCache.clear()
  log.info('Cache chunk NER svuotata', { previousSize: nerChunkCache.size })
}

export function resetNerPipeline(): void {
  nerPipeline = null
  _pipelineFactory = null
  _transformersLoadAttempted = false
  modelLoadFailed = false
  clearNerChunkCache()
  log.info('Pipeline NER resettata')
}

const NER_MODEL_SUBDIR = 'models/italian-ner-xxl-v2'

export function getModelPath(): string {
  return join(app.getPath('userData'), NER_MODEL_SUBDIR)
}

export function getModelDownloadPath(): string {
  return getModelPath()
}

const TESSDATA_SUBDIR = 'tessdata'

export function getTessdataPath(): string {
  return join(app.getPath('userData'), TESSDATA_SUBDIR)
}

export function getTessdataDownloadPath(): string {
  return getTessdataPath()
}

const PUBLIC_INSTITUTION_PREFIXES = new Set([
  'tribunale','corte','procura','pretura','questura','ministero','ministro',
  'comune','regione','provincia','prefettura','inps','inail','agenzia',
  'guardia','polizia','carabinieri','finanza','stato','repubblica',
  'governo','parlamento','senato','camera',
])

const PKI_NOISE = new Set(['ng','ca','ra','tsa','ocsp','crl','sub','root','g1','g2','g3','g4'])

const ALLCAPS_BLOCKLIST = new Set([
  'inps','inail','inpgi','inpdap','spa','srl','snc','sas','sapa','onlus','ong',
  'asl','usl','ssr','ssn','pec','iban','cig','cup',
  'tribunale','corte','procura','ministero','comune','regione',
  'repubblica','italiana','stato','governo'
])

const SCORE_THRESHOLDS: Record<string, number> = { PER: 0.50, ORG: 0.60, LOC: 0.65 }


function isAllCaps(text: string): boolean {
  return /^[A-Z\u00C0-\u00DC\s']+$/.test(text)
}

const LABEL_TO_ENTITY_TYPE: Record<string, EntityType> = {
  PER: 'PERSONA',
  LOC: 'LUOGO',
  ORG: 'ORGANIZZAZIONE'
}

function normalizeLabel(label: string): string {
  return label.replace(/^[BI]-/, '').toUpperCase()
}

let nerPipeline: NerPipelineFn | null = null
let modelLoadFailed = false

async function getNerPipeline(): Promise<NerPipelineFn | null> {
  if (nerPipeline) return nerPipeline
  if (modelLoadFailed) return null

  const modelPath = getModelPath()
  const fs = require('fs')
  const path = require('path')

  // Migrazione automatica: sposta modello da root a onnx/
  const oldOnnxPath = path.join(modelPath, 'model_quantized.onnx')
  const newOnnxDir = path.join(modelPath, 'onnx')
  const newOnnxPath = path.join(newOnnxDir, 'model_quantized.onnx')
  
  try {
    if (!fs.existsSync(newOnnxDir)) fs.mkdirSync(newOnnxDir, { recursive: true })
    if (fs.existsSync(oldOnnxPath) && !fs.existsSync(newOnnxPath)) {
      log.info('Migrazione modello in onnx/')
      fs.renameSync(oldOnnxPath, newOnnxPath)
    }
  } catch (err) {
    log.warn('Errore migrazione modello', { error: err })
  }

  const modelExists = fs.existsSync(newOnnxPath)
  log.info('NER diagnostics', { modelPath, modelExists, platform: process.platform, arch: process.arch })

  const pipelineFactory = await tryLoadTransformers()
  if (!pipelineFactory) {
    modelLoadFailed = true
    return null
  }

  try {
    log.info('Inizializzazione pipeline NER...', { path: modelPath })
    const startMs = Date.now()
    const numThreads = Math.min(4, require('os').cpus().length)

    nerPipeline = await pipelineFactory('token-classification', modelPath, {
      local_files_only: true,
      model_file_name: 'model_quantized',
      session_options: {
        intraOpNumThreads: numThreads,
        interOpNumThreads: 1,
        executionProviders: ['cpu'] 
      }
    }) as unknown as NerPipelineFn

    log.info('Modello NER caricato', { ms: Date.now() - startMs, threads: numThreads })
    return nerPipeline
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('Errore durante inizializzazione pipeline NER', { error: message })
    modelLoadFailed = true
    return null
  }
}

function buildEntity(originalText: string, type: EntityType, source: DetectedEntity['source'] = 'regex'): DetectedEntity {
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    originalText,
    pseudonym: '',
    occurrences: 0,
    confirmed: type !== 'LUOGO',
    source,
  }
}

function countOccurrences(text: string, entityText: string): number {
  const escaped = entityText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(escaped, 'gi')) ?? []).length
}

const NAME_STOPWORDS = new Set([
  'dott', 'dott.ssa', 'avv', 'ing', 'prof', 'sig', 'sig.ra', 'on', 'dr',
  'presidente', 'consigliere', 'giudice', 'relatore', 'ricorrente', 'appellante',
  'resistente', 'convenuto', 'attore', 'equa', 'riparazione', 'sez', 'sezione',
  'di', 'del', 'della', 'dello', 'dei', 'degli', 'da', 'in', 'con', 'per', 'tra',
  'il', 'lo', 'la', 'le', 'gli', 'un', 'una', 'e', 'o', '-',
])

function nameTokenSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[.\-–,;:()]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w))
  )
}

function isSameName(a: string, b: string): boolean {
  const setA = nameTokenSet(a)
  const setB = nameTokenSet(b)
  if (setA.size < 2 || setB.size < 2) return false
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA]
  for (const token of smaller) {
    if (!larger.has(token)) return false
  }
  return true
}

interface AggregatedEntity { word: string; label: string; score: number }

function aggregateBioTokens(items: TokenClassificationSingle[]): AggregatedEntity[] {
  const aggregated: AggregatedEntity[] = []
  let current: AggregatedEntity | null = null
  const MAX_WORDS = 5

  for (const item of items) {
    const normalized = normalizeLabel(item.entity)
    if (normalized === 'O') { if (current) { aggregated.push(current); current = null } continue }

    const isWordPieceContinuation = item.word.startsWith('##')
    const isSameEntity = current && current.label === normalized && !item.entity.startsWith('B-')
    const currentWordCount = current ? current.word.split(' ').length : 0

    if (isWordPieceContinuation && current) {
      current.word += item.word.replace(/^##/, '')
      current.score = Math.min(current.score, item.score)
    } else if (isSameEntity && currentWordCount < MAX_WORDS) {
      const prevWord = current!.word
      const noSpace = prevWord.endsWith("'") || item.word.startsWith("'") || item.word === "'"
      current!.word += noSpace ? item.word : ' ' + item.word
      current!.score = Math.min(current!.score, item.score)
    } else {
      if (current) aggregated.push(current)
      current = { word: item.word, label: normalized, score: item.score }
    }
  }
  if (current) aggregated.push(current)
  return aggregated
}

/**
 * Espande le entità rilevate aggiungendo menzioni co-referenziali single-token.
 * Per ogni entità PERSONA con source 'ner' e score > 0.75 e almeno 2 token:
 * - Estrae ogni token con lunghezza > 3 caratteri non in LEGAL_STOP_WORDS
 * - Se il token appare ≥ 2 volte nel testo standalone E non è già coperto: aggiunge entità co-ref
 */
/** Soglia minima BERT per tentare il boost (entità sotto soglia ma con segnale residuo) */
const BOOST_MIN_SCORE = 0.35

/**
 * Promuove entità BERT sotto-soglia se lo stesso testo è confermato da un'entità
 * regex contestuale Step 0b (source 'regex').
 * La conferma regex è sufficiente per promuovere l'entità indipendentemente dallo score BERT esatto,
 * dato che lo score non è più disponibile dopo buildEntity.
 * Le entità promosse ricevono source 'boosted'.
 * Solo i pattern Step 0b (contestuali legali) fanno da booster — NON CF/IBAN/email/telefono.
 */
export function applyContextualBoost(
  bertLow: DetectedEntity[],
  regexContextual: DetectedEntity[]
): DetectedEntity[] {
  const boosted: DetectedEntity[] = []

  for (const bertEntity of bertLow) {
    // Cerca conferma in regex contestuale — stesso testo (case-insensitive)
    // Solo entità regex di tipo PERSONA/ORG/LOC (contestuali) fanno da booster
    const nerLikeTypes = new Set<EntityType>(['PERSONA', 'ORGANIZZAZIONE', 'LUOGO'])
    const confirmed = regexContextual.some(r =>
      nerLikeTypes.has(r.type) &&
      r.originalText.toLowerCase() === bertEntity.originalText.toLowerCase()
    )
    if (!confirmed) continue

    boosted.push({ ...bertEntity, source: 'boosted' })
  }

  return boosted
}

export function expandCoReferences(entities: DetectedEntity[], text: string): DetectedEntity[] {
  const existingTexts = new Set(entities.map(e => e.originalText.toLowerCase()))
  const additions: DetectedEntity[] = []

  for (const entity of entities) {
    // Solo entità PERSONA rilevate da BERT con score sufficiente
    if (entity.type !== 'PERSONA') continue
    if (entity.source !== 'ner') continue

    const tokens = entity.originalText
      .split(/\s+/)
      .map(t => t.replace(/[.,;:()''"]/g, '').trim())
      .filter(t => t.length > 3 && !LEGAL_STOP_WORDS.has(t.toLowerCase()))

    // Serve almeno un nome completo (2+ token originali)
    if (entity.originalText.trim().split(/\s+/).length < 2) continue

    for (const token of tokens) {
      const tokenLower = token.toLowerCase()
      // Non aggiungere se già presente come entità autonoma
      if (existingTexts.has(tokenLower)) continue

      // Conta occorrenze standalone nel testo
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const occurrences = (text.match(new RegExp(`\\b${escaped}\\b`, 'gi')) ?? []).length
      if (occurrences < 2) continue

      existingTexts.add(tokenLower)
      additions.push({
        id: `PERSONA_coref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'PERSONA',
        originalText: token,
        pseudonym: entity.pseudonym, // stesso pseudonimo dell'entità padre
        occurrences,
        confirmed: true,
        source: 'coref',
      })
    }
  }

  return [...entities, ...additions]
}

export interface NerAnalysisResult {
  entities: DetectedEntity[]
  nerUsed: boolean
  llmUsed: boolean
  warnings: string[]
}

export async function analyzeText(
  text: string,
  llmConfig?: LlmConfig,
  onLlmProgress?: (page: number, total: number) => void,
  pages?: string[]
): Promise<NerAnalysisResult> {
  const warnings: string[] = []
  const foundTexts = new Set<string>()
  let allEntities: DetectedEntity[] = []
  let nerUsed = false
  let llmUsed = false

  SENTENCE_HEADER_PATTERN.lastIndex = 0
  for (const match of text.matchAll(SENTENCE_HEADER_PATTERN)) {
    const raw = match[1].trim()
    if (!raw || raw.split(/\s+/).length < 2) continue
    if (foundTexts.has(raw.toLowerCase())) continue
    foundTexts.add(raw.toLowerCase())
    allEntities.push(buildEntity(raw, 'PERSONA'))
  }

  for (const { pattern, type } of STRUCTURED_LEGAL_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[2] ?? match[0]).trim()
      if (!raw) continue
      if (type === 'PERSONA' && raw.split(/\s+/).length < 2) continue
      if (foundTexts.has(raw.toLowerCase())) continue
      if (type === 'PERSONA' && isAllCaps(raw)) {
        const tokens = raw.split(/\s+/)
        if (tokens.some((t) => t.length <= 2 || ALLCAPS_BLOCKLIST.has(t.toLowerCase()))) continue
      }
      foundTexts.add(raw.toLowerCase())
      allEntities.push(buildEntity(raw, type))
    }
  }

  AVV_LISTA_PATTERN.lastIndex = 0
  for (const match of text.matchAll(AVV_LISTA_PATTERN)) {
    const block = match[1].trim()
    const names = block.split(/\s*,\s*/).map((s) => s.trim()).filter((s) => s.length > 2)
    for (const name of names) {
      if (name.split(/\s+/).length < 2) continue
      if (foundTexts.has(name.toLowerCase())) continue
      foundTexts.add(name.toLowerCase())
      allEntities.push(buildEntity(name, 'PERSONA'))
    }
  }

  PKI_FIRMA_PATTERN.lastIndex = 0
  for (const match of text.matchAll(PKI_FIRMA_PATTERN)) {
    const raw = match[1].trim()
    if (!raw || foundTexts.has(raw.toLowerCase())) continue
    foundTexts.add(raw.toLowerCase())
    allEntities.push(buildEntity(raw, 'PERSONA'))
  }

  // Applica i pattern strutturati (Step 1), usando il pattern CF selezionato dal flag strictCF
  const cfPattern = getCFPattern()
  const effectiveRegexPatterns = REGEX_PATTERNS.map(({ type, pattern }) =>
    type === 'CODICE_FISCALE' ? { type, pattern: cfPattern } : { type, pattern }
  )
  for (const { type, pattern } of effectiveRegexPatterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[0]).trim()
      if (!raw || foundTexts.has(raw.toLowerCase())) continue
      foundTexts.add(raw.toLowerCase())
      allEntities.push(buildEntity(raw, type))
    }
  }

  // Raccoglie entità regex Step 0b per il boost cross-layer
  // (già in allEntities, ma servono separatamente per il confronto testo)
  const regexContextualEntities = allEntities.filter(e => e.source === 'regex')

  const pipe = await getNerPipeline()
  if (pipe) {
    try {
      const chunks = splitTextIntoChunks(text, 400)
      const BATCH = 4
      // Entità BERT sotto soglia (0.35–threshold) accumulate per il boost
      const bertLowScore: DetectedEntity[] = []

      // Cattura il riferimento non-null al pipe per la closure
      const pipeNonNull: NerPipelineFn = pipe

      // Processa chunk con cache: se il chunk è già stato visto in questa sessione,
      // riusa le entità cached senza invocare il modello BERT.
      async function processChunk(chunk: string): Promise<{ aboveThreshold: DetectedEntity[]; belowThreshold: DetectedEntity[] }> {
        const cached = getCachedChunkEntities(chunk)
        if (cached) {
          return { aboveThreshold: cached, belowThreshold: [] }
        }

        const raw = await pipeNonNull(chunk)
        const flat: TokenClassificationSingle[] = Array.isArray(raw[0])
          ? (raw as TokenClassificationOutput[]).flat()
          : (raw as TokenClassificationOutput)
        const aggregated = aggregateBioTokens(flat)

        const aboveThreshold: DetectedEntity[] = []
        const belowThreshold: DetectedEntity[] = []

        for (const { word, label, score } of aggregated) {
          const threshold = SCORE_THRESHOLDS[label] ?? 0.50
          const entityType = LABEL_TO_ENTITY_TYPE[label]
          if (!entityType) continue
          const cleaned = word.trim().replace(/^#+/, '')
          if (cleaned.length < 3) continue
          if (/^[.\s]/.test(cleaned)) continue
          const cleanedFirstWord = cleaned.toLowerCase().split(/\s+/)[0]
          if (NAME_STOPWORDS.has(cleanedFirstWord)) continue
          if (PKI_NOISE.has(cleaned.toLowerCase())) continue
          if (entityType === 'ORGANIZZAZIONE' && PUBLIC_INSTITUTION_PREFIXES.has(cleanedFirstWord)) continue
          if (entityType === 'PERSONA' && LEGAL_STOP_WORDS.has(cleaned.toLowerCase())) continue

          if (score >= threshold) {
            aboveThreshold.push(buildEntity(cleaned, entityType, 'ner'))
          } else if (score >= BOOST_MIN_SCORE) {
            belowThreshold.push(buildEntity(cleaned, entityType, 'ner'))
          }
        }

        // Salva in cache solo le entità sopra soglia (deterministiche)
        setCachedChunkEntities(chunk, aboveThreshold)
        return { aboveThreshold, belowThreshold }
      }

      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH)
        const results = await Promise.all(batch.map(processChunk))
        for (const { aboveThreshold, belowThreshold } of results) {
          for (const entity of aboveThreshold) {
            if (foundTexts.has(entity.originalText.toLowerCase())) continue
            foundTexts.add(entity.originalText.toLowerCase())
            allEntities.push(entity)
          }
          for (const entity of belowThreshold) {
            if (!foundTexts.has(entity.originalText.toLowerCase())) {
              bertLowScore.push(entity)
            }
          }
        }
      }

      // Score boosting: promuovi entità BERT sotto soglia confermate da regex contestuale
      const boosted = applyContextualBoost(bertLowScore, regexContextualEntities)
      for (const entity of boosted) {
        if (!foundTexts.has(entity.originalText.toLowerCase())) {
          foundTexts.add(entity.originalText.toLowerCase())
          allEntities.push(entity)
        }
      }

      nerUsed = true
    } catch (err) {
      log.error('Errore durante inferenza NER', { error: err })
      const modelPath = getModelPath()
      const fs = require('fs')
      const path = require('path')
      const modelExists = fs.existsSync(path.join(modelPath, 'onnx', 'model_quantized.onnx'))
      if (modelExists) {
        warnings.push('Il modello NER è presente ma non si è avviato correttamente. Rilevati solo dati strutturati (CF, P.IVA, IBAN, email, telefono). Verifica manualmente nomi e luoghi.')
      } else {
        warnings.push('Modello NER non trovato. Rilevati solo dati strutturati (CF, P.IVA, IBAN, email, telefono). Verifica manualmente nomi e luoghi.')
      }
    }
  } else {
    const modelPath = getModelPath()
    const fs = require('fs')
    const path = require('path')
    const modelExists = fs.existsSync(path.join(modelPath, 'onnx', 'model_quantized.onnx'))
    if (modelExists) {
      warnings.push('Il modello NER è presente ma non si è avviato correttamente. Rilevati solo dati strutturati (CF, P.IVA, IBAN, email, telefono). Verifica manualmente nomi e luoghi.')
    } else {
      warnings.push('Modello NER non scaricato. Rilevati solo dati strutturati (CF, P.IVA, IBAN, email, telefono). Per attivare il riconoscimento automatico di nomi e luoghi, scarica il modello dalla schermata iniziale.')
    }
  }

  if (llmConfig?.enabled && llmConfig.model) {
    try {
      const effectiveChunkSize = llmConfig.chunkSize !== DEFAULT_LLM_CONFIG.chunkSize
        ? llmConfig.chunkSize        // utente ha modificato manualmente → rispettare
        : inferChunkSize(llmConfig.model)  // auto-detect dalla taglia del modello
      const usePageMode = pages && pages.length > 0

      let chunks: string[]
      if (usePageMode) {
        // Page-mode: ogni pagina PDF è una richiesta separata.
        // Se una singola pagina supera chunkSize, la spezza comunque.
        chunks = pages!.flatMap((page) =>
          page.trim().length > effectiveChunkSize
            ? splitTextIntoLlmChunks(page, effectiveChunkSize)
            : page.trim().length > 50 ? [page] : []
        )
      } else {
        // Chunk-mode (default): chunking fisso sul testo completo
        chunks = splitTextIntoLlmChunks(text, effectiveChunkSize)
      }

      // ≤4B: KV cache LM Studio troppo piccola per richieste parallele → forza 1
      const isSmallModel = inferChunkSize(llmConfig.model) === 1200
      if (isSmallModel && (llmConfig.parallelRequests ?? 1) > 1) {
        log.warn(`nerService: modello ≤4B rilevato (${llmConfig.model}) — parallelRequests forzato a 1 per evitare context overflow`)
      }
      const effectiveParallel = isSmallModel ? 1 : Math.max(1, llmConfig.parallelRequests ?? 1)
      const LLM_BATCH = effectiveParallel
      let completed = 0
      let llmChunkErrors = 0
      for (let i = 0; i < chunks.length; i += LLM_BATCH) {
        const batch = chunks.slice(i, i + LLM_BATCH)
        const results = await Promise.all(
          batch.map((chunk) => detectNamesWithLlm(chunk, llmConfig, () => { llmChunkErrors++ }))
        )
        completed += batch.length
        onLlmProgress?.(Math.min(completed, chunks.length), chunks.length)
        for (const llmNames of results) {
          for (const { original, replacement } of llmNames) {
            const trimmed = original.trim()
            if (!trimmed || foundTexts.has(trimmed.toLowerCase())) continue
            const type: EntityType = /^([A-Z]\.\s*)+$/.test(replacement.trim()) ? 'PERSONA' : 'ORGANIZZAZIONE'
            foundTexts.add(trimmed.toLowerCase())
            const pseudonym = sessionManager.registerLlmPseudonym(trimmed, replacement.trim(), type)
            allEntities.push({ ...buildEntity(trimmed, type, 'llm'), pseudonym })
          }
        }
      }
      if (llmChunkErrors > 0) {
        const sez = llmChunkErrors === 1 ? 'sezione' : 'sezioni'
        const analizzata = llmChunkErrors === 1 ? 'analizzata' : 'analizzate'
        warnings.push(`LLM: ${llmChunkErrors} ${sez} non ${analizzata} per errore del server. I risultati potrebbero essere incompleti.`)
      }
      if (chunks.length - llmChunkErrors > 0) {
        llmUsed = true
      }
    } catch (err) {
      log.warn('nerService: errore LLM, continuo senza', { error: err })
      warnings.push('LLM locale non raggiungibile. Usato solo BERT + regex.')
    }
  }

  {
    const toRemove = new Set<string>()
    const nerLikeEntities = allEntities.filter((e) => e.type === 'PERSONA' || e.type === 'ORGANIZZAZIONE')
    for (let i = 0; i < nerLikeEntities.length; i++) {
      if (toRemove.has(nerLikeEntities[i].id)) continue
      for (let j = i + 1; j < nerLikeEntities.length; j++) {
        if (toRemove.has(nerLikeEntities[j].id)) continue
        const a = nerLikeEntities[i]
        const b = nerLikeEntities[j]
        if (!isSameName(a.originalText, b.originalText)) continue
        const aLen = nameTokenSet(a.originalText).size
        const bLen = nameTokenSet(b.originalText).size
        const occA = countOccurrences(text, a.originalText)
        const occB = countOccurrences(text, b.originalText)
        const [keep, drop] = aLen <= bLen && (aLen < bLen || occA >= occB) ? [a, b] : [b, a]
        if (keep.pseudonym && !drop.pseudonym) sessionManager.registerLlmPseudonym(drop.originalText, keep.pseudonym, keep.type)
        toRemove.add(drop.id)
      }
    }
    if (toRemove.size > 0) allEntities = allEntities.filter((e) => !toRemove.has(e.id))
  }

  const nerTypes = new Set<EntityType>(['PERSONA', 'ORGANIZZAZIONE', 'LUOGO'])
  for (const entity of allEntities.filter((e) => nerTypes.has(e.type))) {
    const upperVariant = entity.originalText.toUpperCase()
    if (upperVariant !== entity.originalText && !foundTexts.has(upperVariant.toLowerCase())) {
      const escaped = upperVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`).test(text)) {
        foundTexts.add(upperVariant.toLowerCase())
        allEntities.push({ ...buildEntity(upperVariant, entity.type), pseudonym: entity.pseudonym })
      }
    }
  }

  for (const entity of allEntities) entity.occurrences = countOccurrences(text, entity.originalText)

  allEntities = allEntities.filter((entity) => {
    if (entity.occurrences === 0) return false
    if (!nerTypes.has(entity.type)) return true
    const longer = allEntities.filter((e) => e !== entity && e.type === entity.type && e.originalText.length > entity.originalText.length)
    const shorter = allEntities.filter((e) => e !== entity && e.type === entity.type && e.originalText.length < entity.originalText.length)
    if (entity.originalText.trim().split(/\s+/).length === 1) {
      if (longer.some((e) => e.originalText.toLowerCase().includes(entity.originalText.toLowerCase()))) {
        const shortEscaped = entity.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const standaloneOcc = (text.match(new RegExp(`\\b${shortEscaped}\\b`, 'gi')) ?? []).length
        const containerOcc = Math.max(...longer.filter((e) => e.originalText.toLowerCase().includes(entity.originalText.toLowerCase())).map((e) => e.occurrences))
        if (standaloneOcc <= containerOcc * 2) return false
      }
    }
    const containsShorter = shorter.some((e) => {
      if (e.originalText.trim().split(/\s+/).length < 2) return false
      if (!entity.originalText.toLowerCase().includes(e.originalText.toLowerCase())) return false
      const shortEscaped = e.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const longEscaped = entity.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return (text.match(new RegExp(`\\b${shortEscaped}\\b`, 'gi')) ?? []).length <= (text.match(new RegExp(longEscaped, 'gi')) ?? []).length
    })
    return !containsShorter
  })

  // Co-reference resolution: espande con menzioni single-token delle entità PERSONA BERT
  if (nerUsed) {
    allEntities = expandCoReferences(allEntities, text)
  }

  allEntities.sort((a, b) => b.occurrences - a.occurrences)
  log.info('Analisi NER completata', { totalEntities: allEntities.length, nerUsed, llmUsed, warnings: warnings.length })
  return { entities: allEntities, nerUsed, llmUsed, warnings }
}

function splitTextIntoLlmChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      if (newline > start) end = newline
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

/**
 * Crea chunk con sliding window e overlap.
 * Chunk N:   token [0 … chunkSize-1]
 * Chunk N+1: token [stride … stride+chunkSize-1]  (overlap di 'overlap' token)
 * Garantisce che entità a cavallo del boundary vengano catturate dal chunk successivo.
 */
export function createOverlappingChunks(
  tokens: string[],
  chunkSize = 400,
  overlap = 40
): string[] {
  if (tokens.length <= chunkSize) return [tokens.join(' ')]
  const stride = chunkSize - overlap
  const chunks: string[] = []
  for (let i = 0; i < tokens.length; i += stride) {
    const slice = tokens.slice(i, i + chunkSize)
    if (slice.length > 0) chunks.push(slice.join(' '))
    if (i + chunkSize >= tokens.length) break
  }
  return chunks
}

function splitTextIntoChunks(text: string, targetWords: number): string[] {
  // Usa sliding window con overlap per evitare entità spezzate a cavallo di boundary
  const tokens = text.split(/\s+/).filter(t => t.length > 0)
  return createOverlappingChunks(tokens, targetWords, 40)
}

