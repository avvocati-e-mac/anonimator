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

export function resetNerPipeline(): void {
  nerPipeline = null
  _pipelineFactory = null
  _transformersLoadAttempted = false
  modelLoadFailed = false
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

const JUDICIAL_ROLES =
  'presidente|consigliere|rel\\.?\\s*consigliere|giudice|sostituto\\s+procuratore|' +
  'procuratore|cancelliere|segretario|relatore|estensore|componente'

const SENTENCE_HEADER_PATTERN = new RegExp(
  '(?:(?:dott\\.?(?:ssa)?|avv\\.?|prof\\.?|ing\\.?)\\s+)?' +
  "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]*'?[A-ZÀ-Üa-zà-ü]*(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})" +
  '\\s*[-–]\\s*(?:' + JUDICIAL_ROLES + ')\\s*[-–]',
  'gi'
)

const REGEX_PATTERNS: { type: EntityType; pattern: RegExp }[] = [
  { type: 'CODICE_FISCALE', pattern: /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi },
  { type: 'PARTITA_IVA', pattern: /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi },
  { type: 'IBAN', pattern: /\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi },
  { type: 'EMAIL', pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi },
  { type: 'TELEFONO', pattern: /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g }
]

const PROCESSO_PARTE_PATTERN = new RegExp(
  '(?:^|\\n)\\s*(?:ricorrente|resistente|appellante|appellato|intimato|' +
  'controricorrente|opponente|opposto|attore|convenuto|debitore|creditore|' +
  'fallito|fallendo|istante|intervenuto)[:\\s,]+' +
  "([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+(?:\\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü']+){1,3})",
  'gi'
)

const DIFENSORE_PATTERN = new RegExp(
  '(?:difeso|difesa|rappresentato|rappresentata|assistito|assistita)\\s+' +
  "(?:dall?['\\u2019])?(?:avv\\.?|avvocato|procuratore)\\s+" +
  "([A-Z][A-Za-z\u00C0-\u00FF']+(?:\\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})",
  'gi'
)

const ALLCAPS_NAME_PATTERN = new RegExp(
  '(?:^|\\n)([A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC\']{1,25}' +
  '(?:\\s+[A-Z\u00C0-\u00DC][A-Z\u00C0-\u00DC]{1,25}){1,2})' +
  '(?:\\s*$|\\s*[+]|\\s*[-\u2013]\\s*(?:$|\\n))',
  'gm'
)

const DATA_NASCITA_PATTERN = /(?:nato|nata|n\.)[\s,]+(?:a\s+\S+\s+)?il\s+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})|(?:data(?:\s+di)?\s+nascita|d\.d\.n\.)[:\s]+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi
const INDIRIZZO_PATTERN = /(?:residente|domiciliato|domiciliata|con\s+sede)\s+(?:in\s+)?(?:Via|Viale|Corso|Piazza|Largo|Vicolo|Str\.|Loc\.|Fraz\.|V\.le)\s+[A-Za-z\u00C0-\u00FF\s0-9,.']{3,50},?\s*\d{5}/gi
const NUMERO_DOCUMENTO_PATTERN = /(?:carta(?:\s+d[i']\s*identit[àa])?|passaporto|patente|C\.I\.E?\.?)[\s:,n.°]+([A-Z]{2}[0-9]{5,7}[A-Z]?)|(?:n(?:umero)?\.?\s*doc(?:umento)?[:\s]+)([A-Z]{2}[0-9]{5,7}[A-Z]?)/gi
const POLIZZA_PARTE_PATTERN = /(?:Contraente|Assicurato|Assicurata|Beneficiario|Intestatario)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi
const CONTRATTO_PARTE_PATTERN = /(?:tra|fra)\s+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}),\s+(?:nato|nata|residente|domiciliato|codice\s+fiscale|con\s+sede)/gi
const PERIZIA_SOGGETTO_PATTERN = /(?:Paziente|CTU|C\.T\.U\.|CTP|C\.T\.P\.|Perito|Esaminato|Esaminata)[:\s]+([A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})/gi
const AVV_LISTA_PATTERN = /avvocat[oi]\s+((?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3})(?:\s*,\s*(?:[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+){1,3}))*)/gi
const PKI_FIRMA_PATTERN = /Firmato\s+Da:\s+([A-Z][A-Z\u00C0-\u00DC]+\s+[A-Z][A-Z\u00C0-\u00DC]+)\s+Emesso/gi

const STRUCTURED_LEGAL_PATTERNS: { pattern: RegExp; type: EntityType }[] = [
  { pattern: PROCESSO_PARTE_PATTERN,   type: 'PERSONA' },
  { pattern: DIFENSORE_PATTERN,        type: 'PERSONA' },
  { pattern: ALLCAPS_NAME_PATTERN,     type: 'PERSONA' },
  { pattern: DATA_NASCITA_PATTERN,     type: 'DATA_NASCITA' },
  { pattern: INDIRIZZO_PATTERN,        type: 'INDIRIZZO' },
  { pattern: NUMERO_DOCUMENTO_PATTERN, type: 'NUMERO_DOCUMENTO' },
  { pattern: POLIZZA_PARTE_PATTERN,    type: 'PERSONA' },
  { pattern: CONTRATTO_PARTE_PATTERN,  type: 'PERSONA' },
  { pattern: PERIZIA_SOGGETTO_PATTERN, type: 'PERSONA' },
]

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

function buildEntity(originalText: string, type: EntityType): DetectedEntity {
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    originalText,
    pseudonym: '',
    occurrences: 0,
    confirmed: type !== 'LUOGO'
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

  for (const { type, pattern } of REGEX_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[0]).trim()
      if (!raw || foundTexts.has(raw.toLowerCase())) continue
      foundTexts.add(raw.toLowerCase())
      allEntities.push(buildEntity(raw, type))
    }
  }

  const pipe = await getNerPipeline()
  if (pipe) {
    try {
      const chunks = splitTextIntoChunks(text, 400)
      const BATCH = 4
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH)
        const results = await Promise.all(batch.map((chunk) => pipe(chunk)))
        for (const raw of results) {
          const flat: TokenClassificationSingle[] = Array.isArray(raw[0])
            ? (raw as TokenClassificationOutput[]).flat()
            : (raw as TokenClassificationOutput)
          const aggregated = aggregateBioTokens(flat)
          for (const { word, label, score } of aggregated) {
            const threshold = SCORE_THRESHOLDS[label] ?? 0.50
            if (score < threshold) continue
            const entityType = LABEL_TO_ENTITY_TYPE[label]
            if (!entityType) continue
            const cleaned = word.trim().replace(/^#+/, '')
            if (cleaned.length < 3) continue
            if (/^[.\s]/.test(cleaned)) continue
            const cleanedFirstWord = cleaned.toLowerCase().split(/\s+/)[0]
            if (NAME_STOPWORDS.has(cleanedFirstWord)) continue
            if (PKI_NOISE.has(cleaned.toLowerCase())) continue
            if (entityType === 'ORGANIZZAZIONE' && PUBLIC_INSTITUTION_PREFIXES.has(cleanedFirstWord)) continue
            if (foundTexts.has(cleaned.toLowerCase())) continue
            foundTexts.add(cleaned.toLowerCase())
            allEntities.push(buildEntity(cleaned, entityType))
          }
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
            allEntities.push({ ...buildEntity(trimmed, type), pseudonym })
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
