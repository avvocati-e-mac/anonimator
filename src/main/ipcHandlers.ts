import { ipcMain, BrowserWindow, shell, app, dialog, clipboard } from 'electron'
import { z } from 'zod'
import { privacyLog as log, safeErrorCode } from './services/privacyLogger'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs'
import https from 'https'
import crypto from 'crypto'
import { IPC_CHANNELS } from '@shared/types'
import type { EntityDictionaryFile } from '@shared/types'
import { analyzeText, getModelPath, getModelDownloadPath, getTessdataPath, getTessdataDownloadPath, resetNerPipeline, clearNerChunkCache } from './services/nerService'
import { sessionManager } from './services/sessionManager'
import { settingsManager } from './services/settingsManager'
import { formatInstallationDiagnostics } from './services/diagnostics'
import { testLlmConnection, listLlmModels, SYSTEM_PROMPT_IT, SYSTEM_PROMPT_EN } from './services/llmService'
import { detectFormat, extractText } from './parsers/index'
import { anonymizationProgressMessage, buildOcrProgressMessage, ocrProgressPercent } from './services/ocrProgressMessage'
import { generateOutput } from './outputGenerators/index'
import { analysisRegistry, AnalysisTokenError } from './services/analysisRegistry'
import { ocrArtifactCache } from './services/ocrArtifactCache'
import type {
  EntityDecision,
  EntityRedactionOutcome,
  PartialReason,
  SaveResult,
} from '@shared/types'

function getSessionDictPath(): string {
  return join(app.getPath('userData'), 'anonimator-session.json')
}

// ─── Schemi di validazione Zod ────────────────────────────────────────────────

const ProcessDocumentSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .refine(
      (p) =>
        ['.pdf', '.docx', '.odt', '.txt', '.md', '.png', '.jpg', '.jpeg'].some((ext) =>
          p.toLowerCase().endsWith(ext)
        ),
      { message: 'Formato file non supportato' }
    ),
  // Forza l'OCR interno ignorando il layer di testo esistente (dopo banner di layer disallineato)
  forceOcr: z.boolean().optional(),
  // DPI di rendering per l'OCR forzato — clamp ragionevole per evitare rendering abnormi
  ocrDpi: z.number().int().min(72).max(1200).optional()
})

const EntityTypeEnum = z.enum([
  'PERSONA', 'ORGANIZZAZIONE', 'LUOGO', 'CODICE_FISCALE',
  'PARTITA_IVA', 'IBAN', 'EMAIL', 'TELEFONO', 'DATA_NASCITA',
  'LUOGO_NASCITA', 'INDIRIZZO', 'NUMERO_DOCUMENTO', 'TARGA'
])

const EntityDecisionSchema = z.object({
  entityId: z.string().min(1).max(128),
  type: EntityTypeEnum,
  originalText: z.string().trim().min(1).max(500),
  pseudonym: z.string().trim().min(1).max(200),
  confirmed: z.boolean(),
}).strict()

export const AnonymizeRequestSchema = z.object({
  analysisToken: z.string().regex(/^[a-f0-9]{64}$/),
  entities: z.array(EntityDecisionSchema).max(10_000),
}).strict().superRefine((request, context) => {
  const seen = new Set<string>()
  request.entities.forEach((entity, index) => {
    if (seen.has(entity.entityId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entities', index, 'entityId'],
        message: 'ID entità duplicato',
      })
    }
    seen.add(entity.entityId)
  })
})

const LlmConfigSchema = z.object({
  enabled: z.boolean(),
  providerType: z.enum(['ollama', 'openai_compat']),
  providerPreset: z.enum(['ollama', 'lmstudio', 'mlx', 'custom']),
  baseUrl: z.string().min(1),
  model: z.string(),
  maxTokens: z.number().int().min(256).max(32768),
  timeoutMs: z.number().int().min(5000).max(600000),
  parallelRequests: z.number().int().min(1).max(4),
  customPrompt: z.string().optional(),
  // TODO [A/B-TEST]: rimuovere promptLanguage dopo ottimizzazione prompt
  promptLanguage: z.enum(['it', 'en']).default('it'),
  chunkSize: z.number().int().min(1000).max(8000).default(3000),
  stream: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0)
})

// ─── Helper: invia progresso alla finestra attiva ─────────────────────────────
function sendProgress(stage: string, percent: number, message: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send(IPC_CHANNELS.DOC_PROGRESS, { stage, percent, message })
  }
}

function toGeneratorEntities(
  decisions: EntityDecision[],
  ledger: Map<string, { expectedOccurrences: number | null }>,
): import('@shared/types').DetectedEntity[] {
  return decisions.map((decision) => ({
    id: decision.entityId,
    type: decision.type,
    originalText: decision.originalText,
    pseudonym: decision.pseudonym,
    confirmed: decision.confirmed,
    occurrences: ledger.get(decision.entityId)?.expectedOccurrences ?? 1,
    expectedOccurrences: ledger.get(decision.entityId)?.expectedOccurrences ?? null,
  }))
}

function normalizeSaveResult(
  generated: Awaited<ReturnType<typeof generateOutput>>,
  decisions: EntityDecision[],
  ledger: Map<string, { expectedOccurrences: number | null }>,
  hasAnalysisPageError: boolean,
  redactionMode: SaveResult['redactionMode'],
): SaveResult {
  const richer = generated as typeof generated & { outcomes?: EntityRedactionOutcome[]; partialReasons?: PartialReason[] }
  const outcomes = richer.outcomes ?? decisions.filter((entity) => entity.confirmed).map((entity) => ({
    entityId: entity.entityId,
    expectedOccurrences: ledger.get(entity.entityId)?.expectedOccurrences ?? null,
    // I generator legacy non espongono ancora un ledger per entità. Zero è il
    // solo valore fail-closed: non si dichiara completa una sostituzione non provata.
    matchedOccurrences: 0,
    redactedOccurrences: 0,
    ambiguousOccurrences: 0,
    rejectedOccurrences: 0,
  }))
  const reasons = new Set<PartialReason>(richer.partialReasons ?? [])
  if (hasAnalysisPageError) reasons.add('analysis-page-error')
  for (const outcome of outcomes) {
    const complete = outcome.expectedOccurrences === null
      ? outcome.redactedOccurrences > 0
      : outcome.redactedOccurrences === outcome.expectedOccurrences
    if (!complete) reasons.add(outcome.redactedOccurrences === 0 ? 'entity-unmatched' : 'entity-count-mismatch')
    if (outcome.ambiguousOccurrences > 0) reasons.add('ambiguous-overlap')
    if (outcome.rejectedOccurrences > 0) reasons.add('rejected-rectangle')
  }
  return {
    outputPath: generated.outputPath,
    safetyStatus: reasons.size === 0 ? 'complete' : 'partial',
    partialReasons: [...reasons],
    outcomes,
    entitiesReplaced: outcomes.filter((outcome) => outcome.redactedOccurrences > 0).length,
    redactionMode,
    sizeRatio: generated.sizeRatio,
    sizeWarning: generated.sizeWarning,
  }
}

function ipcError(error: unknown): { error: string; code?: string } {
  if (error instanceof AnalysisTokenError) return { error: error.message, code: error.code }
  const message = error instanceof Error ? error.message : String(error)
  return { error: `Errore durante l'anonimizzazione: ${message}` }
}

// ─── Registrazione handler ────────────────────────────────────────────────────

export function registerIpcHandlers(): void {
  app.once('before-quit', () => analysisRegistry.clear())

  // Handler: avvia analisi documento
  ipcMain.handle(IPC_CHANNELS.DOC_PROCESS, async (event, payload: unknown) => {
    const parsed = ProcessDocumentSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC doc:process — payload non valido', parsed.error.flatten())
      return { error: 'Formato file non supportato o percorso non valido.' }
    }

    const { filePath, forceOcr, ocrDpi } = parsed.data
    const llmConfig = settingsManager.getLlmConfig()

    let pendingOcrArtifactHandle: string | undefined
    try {
      if (forceOcr) await analysisRegistry.invalidateForPath(event.sender.id, filePath)
      // Fase 1: rilevamento formato e parsing
      sendProgress('parsing', 10, 'Lettura documento...')
      const format = detectFormat(filePath)
      log.info('Inizio elaborazione documento', { format })

      // Se si sta rifacendo l'OCR (forceOcr), la passata precedente potrebbe aver già
      // arricchito e registrato pseudonimi nel dizionario di sessione (enrichEntities
      // gira anche solo per l'anteprima, prima che l'utente confermi alcunché). Uno
      // snapshot/restore evita che quella passata scartata lasci voci spurie permanenti.
      const sessionSnapshot = forceOcr ? sessionManager.snapshot() : null

      sendProgress('parsing', 30, 'Lettura del testo...')

      // L'OCR di un documento lungo occupa minuti. Senza un segnale per pagina la
      // barra resta ferma dall'inizio alla fine e l'unica informazione che arriva
      // e' un messaggio generico: chi guarda non puo' distinguere "sta lavorando"
      // da "si e' piantato". Qui l'avanzamento reale occupa la banda 30-48%.
      const ocrStartedAt = Date.now()
      let ocrPagesDone = 0
      const onOcrProgress = (page: number, totalPages: number): void => {
        sendProgress(
          'ocr',
          ocrProgressPercent(page, totalPages),
          buildOcrProgressMessage(page, totalPages, ocrStartedAt, ocrPagesDone)
        )
        // Il conteggio si incrementa DOPO: la stima deve basarsi sulle pagine
        // davvero concluse, non su quella appena iniziata.
        ocrPagesDone = page
      }

      const parseResult = await extractText(filePath, format, { forceOcr, ocrDpi }, onOcrProgress)
      pendingOcrArtifactHandle = parseResult.ocrArtifactHandle
      const { text, pageCount, warnings: parseWarnings, isScanned: docIsScanned, previewHtml, ocrReport, pdfSafety } =
        parseResult

      if (sessionSnapshot) {
        sessionManager.restore(sessionSnapshot)
      }

      if (ocrReport) {
        // Solo metadati numerici/etichette — mai contenuto documentale (CLAUDE.md §6)
        log.info('Layer OCR verificato', {
          layerKind: ocrReport.layerKind,
          verdict: ocrReport.verdict,
          imageQuality: ocrReport.imageQuality,
          pagesSampled: ocrReport.pagesSampled
        })
      }

      // Fase 2: analisi NER (BERT + regex, opzionalmente LLM)
      sendProgress('ner', 50, 'Riconoscimento entità...')
      if (llmConfig.enabled && llmConfig.model) {
        sendProgress('ner', 50, 'Riconoscimento entità (BERT + LLM)...')
      }
      const { entities: rawEntities, nerUsed, llmUsed, warnings: nerWarnings } =
        await analyzeText(text, llmConfig, (page, total) => {
          const pct = 50 + Math.round((page / total) * 30)
          const effectiveTotal = format === 'pdf' && pageCount > 0 ? pageCount : total
          const msg = format === 'pdf'
            ? `Analisi LLM: pagina ${page}/${effectiveTotal}...`
            : `Analisi LLM: chunk ${page} di ${total}...`
          sendProgress('ner', pct, msg)
        })

      // Assegna pseudonimi dalla sessione corrente
      sendProgress('ner', 85, 'Assegnazione pseudonimi...')
      const enrichedEntities = sessionManager.previewEntities(rawEntities)

      const analysis = await analysisRegistry.register({
        ownerWebContentsId: event.sender.id,
        filePath,
        format,
        pageCount,
        entities: enrichedEntities,
        isScanned: docIsScanned ?? false,
        ocrReport,
        pageSafety: pdfSafety?.pages.map((page) => ({ page: page.page, kind: page.status })),
        ocrArtifactHandle: pendingOcrArtifactHandle,
      })
      pendingOcrArtifactHandle = undefined
      const ownerWebContentsId = event.sender.id
      event.sender.once('destroyed', () => analysisRegistry.releaseOwner(ownerWebContentsId))

      sendProgress('done', 100, 'Analisi completata.')
      log.info('Documento analizzato', {
        format,
        pageCount,
        entities: enrichedEntities.length,
        nerUsed,
        llmUsed
      })

      return {
        analysisToken: analysis.token,
        fileName: filePath.split('/').pop() ?? filePath,
        format,
        pageCount,
        entities: enrichedEntities,
        warnings: [...parseWarnings, ...nerWarnings],
        isScanned: docIsScanned ?? false,
        // previewHtml presente solo per DOCX — mai loggarne il contenuto
        ...(previewHtml ? { previewHtml } : {}),
        // ocrReport presente solo per PDF — solo metriche numeriche/etichette, mai testo
        ...(ocrReport ? { ocrReport } : {}),
      }
    } catch (err) {
      ocrArtifactCache.discard(pendingOcrArtifactHandle)
      const message = err instanceof Error ? err.message : String(err)
      log.error('document-processing-failed', {
        stage: 'analysis',
        errorCode: safeErrorCode(err),
      })
      return { error: `Errore durante l'elaborazione: ${message}` }
    }
  })

  // Handler: avvia anonimizzazione dopo conferma utente
  ipcMain.handle(IPC_CHANNELS.DOC_ANONYMIZE, async (event, payload: unknown) => {
    const parsed = AnonymizeRequestSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC doc:anonymize — payload non valido', parsed.error.flatten())
      return { error: 'Dati non validi.' }
    }

    try {
      const { analysisToken, entities } = parsed.data
      const record = await analysisRegistry.resolveForSave(analysisToken, event.sender.id)
      analysisRegistry.validateDecisions(record, entities)
      const confirmed = entities.filter((entity) => entity.confirmed)
      const typedEntities = toGeneratorEntities(entities, record.entityLedger)
      sendProgress('parsing', 20, anonymizationProgressMessage('prepare'))
      log.info('Anonimizzazione richiesta', { format: record.format, entitiesConfirmed: confirmed.length })

      sendProgress('parsing', 50, anonymizationProgressMessage('redact'))
      const generated = await generateOutput(record.canonicalPath, record.format, typedEntities, {
        analysisToken,
        isScanned: record.isScanned,
        layerKind: record.ocrReport?.layerKind,
        ocrAligned: record.ocrReport?.verdict === 'aligned',
      })
      const mode: SaveResult['redactionMode'] = record.format === 'pdf' &&
        record.pages.some((page) => page.kind !== 'digital') ? 'flattened-scan' : 'digital'
      const result = normalizeSaveResult(
        generated,
        entities,
        record.entityLedger,
        record.pages.some((page) => page.kind === 'page-error'),
        mode,
      )
      sessionManager.commitDecisions(entities)
      analysisRegistry.release(analysisToken, event.sender.id)

      sendProgress('done', 100, 'Anonimizzazione completata.')
      log.info('Documento anonimizzato', {
        entitiesReplaced: result.entitiesReplaced,
        redactionMode: result.redactionMode,
        safetyStatus: result.safetyStatus,
      })

      // Auto-save sessione su disco
      try { sessionManager.saveToDisk(getSessionDictPath()) } catch { /* ignorato */ }

      return result
    } catch (err) {
      const failure = ipcError(err)
      log.error('Errore anonimizzazione', { code: failure.code ?? 'generation-error' })
      return failure
    }
  })

  // Handler: anonimizzazione batch (N file in sequenza)
  ipcMain.handle(IPC_CHANNELS.BATCH_ANONYMIZE, async (event, payload: unknown) => {
    const RequestSchema = z.array(AnonymizeRequestSchema)
    const parsed = RequestSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC batch:anonymize — payload non valido', parsed.error.flatten())
      return []
    }

    const results: import('@shared/types').BatchResultItem[] = []

    for (const req of parsed.data) {
      try {
        const record = await analysisRegistry.resolveForSave(req.analysisToken, event.sender.id)
        analysisRegistry.validateDecisions(record, req.entities)
        const fileName = record.canonicalPath.split('/').pop() ?? record.canonicalPath
        sendProgress('parsing', 0, `Anonimizzazione: ${fileName}...`)
        const typedEntities = toGeneratorEntities(req.entities, record.entityLedger)
        const generated = await generateOutput(record.canonicalPath, record.format, typedEntities, {
          analysisToken: req.analysisToken,
          isScanned: record.isScanned,
          layerKind: record.ocrReport?.layerKind,
          ocrAligned: record.ocrReport?.verdict === 'aligned',
        })
        const mode: SaveResult['redactionMode'] = record.format === 'pdf' &&
          record.pages.some((page) => page.kind !== 'digital') ? 'flattened-scan' : 'digital'
        const save = normalizeSaveResult(
          generated, req.entities, record.entityLedger,
          record.pages.some((page) => page.kind === 'page-error'), mode,
        )
        sessionManager.commitDecisions(req.entities)
        analysisRegistry.release(req.analysisToken, event.sender.id)
        log.info('Batch: documento anonimizzato', {
          entitiesReplaced: save.entitiesReplaced,
          redactionMode: save.redactionMode,
          safetyStatus: save.safetyStatus,
        })
        results.push({
          filePath: record.canonicalPath,
          fileName,
          outputPath: save.outputPath,
          entitiesReplaced: save.entitiesReplaced,
        })
      } catch (err) {
        const failure = ipcError(err)
        log.error('Batch: errore anonimizzazione', { code: failure.code ?? 'generation-error' })
        results.push({ filePath: '', fileName: '', error: failure.error })
      }
    }

    sendProgress('done', 100, 'Batch completato.')

    // Auto-save sessione su disco
    try { sessionManager.saveToDisk(getSessionDictPath()) } catch { /* ignorato */ }

    return results
  })

  // Handler: reset sessione
  ipcMain.handle(IPC_CHANNELS.SESSION_RESET, async () => {
    sessionManager.reset()
    analysisRegistry.clear()
    clearNerChunkCache()
    log.info('Sessione resettata', sessionManager.getDictionaryStats())
    return { status: 'ok' }
  })

  ipcMain.handle(IPC_CHANNELS.ANALYSIS_RELEASE, (event, payload: unknown) => {
    const parsed = z.object({ analysisToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(payload)
    if (!parsed.success) return { status: 'invalid' }
    return { status: analysisRegistry.release(parsed.data.analysisToken, event.sender.id) ? 'released' : 'unknown' }
  })

  // Handler: ottieni configurazione LLM
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return { llm: settingsManager.getLlmConfig() }
  })

  // Handler: salva configurazione LLM
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, payload: unknown) => {
    const body = payload as { llm?: unknown }
    const parsed = LlmConfigSchema.safeParse(body?.llm)
    if (!parsed.success) {
      log.warn('IPC settings:set — payload non valido', parsed.error.flatten())
      return { error: 'Configurazione non valida.' }
    }
    settingsManager.setLlmConfig(parsed.data)
    return { status: 'ok' }
  })

  // Handler: testa connessione LLM
  ipcMain.handle(IPC_CHANNELS.LLM_TEST, async (_event, payload: unknown) => {
    const body = payload as { llm?: unknown }
    const parsed = LlmConfigSchema.safeParse(body?.llm)
    if (!parsed.success) {
      log.warn('IPC llm:test — payload non valido', parsed.error.flatten())
      return { ok: false, message: 'Configurazione non valida.' }
    }
    return testLlmConnection(parsed.data)
  })

  // Handler: restituisce il prompt di default (IT o EN)
  ipcMain.handle(IPC_CHANNELS.LLM_GET_DEFAULT_PROMPT, (_event, lang: unknown) => {
    return lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_IT
  })

  // Handler: lista modelli disponibili sul server LLM
  ipcMain.handle(IPC_CHANNELS.LLM_LIST_MODELS, async (_event, payload: unknown) => {
    const body = payload as { llm?: unknown }
    const parsed = LlmConfigSchema.safeParse(body?.llm)
    if (!parsed.success) {
      return { models: [] }
    }
    const models = await listLlmModels(parsed.data)
    return { models }
  })

  // Handler: aggiunge un'entità manualmente al dizionario
  ipcMain.handle(IPC_CHANNELS.ENTITY_ADD, (_event, payload: unknown) => {
    const schema = z.object({ originalText: z.string().min(1).max(500), type: EntityTypeEnum })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC entity:add — payload non valido', parsed.error.flatten())
      return { error: 'Dati non validi.' }
    }
    const { originalText, type } = parsed.data
    const pseudonym = sessionManager.getOrCreatePseudonym(originalText, type as import('@shared/types').EntityType)
    return { pseudonym, id: crypto.randomUUID() }
  })

  // Handler: esporta lista entità su file JSON
  ipcMain.handle(IPC_CHANNELS.ENTITY_EXPORT, async (_event, payload: unknown) => {
    const schema = z.object({
      entities: z.array(z.object({
        originalText: z.string(),
        pseudonym: z.string(),
        type: z.string(),
      })),
      defaultFileName: z.string().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'Dati non validi.' }

    const baseName = parsed.data.defaultFileName ?? 'dizionario-entita'
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${baseName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }

    const file: EntityDictionaryFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: parsed.data.entities as EntityDictionaryFile['entries'],
    }
    writeFileSync(result.filePath, JSON.stringify(file, null, 2), 'utf-8')
    log.info('Dizionario entità esportato', { entries: file.entries.length })
    return { saved: true }
  })

  // Handler: importa entità da file JSON
  ipcMain.handle(IPC_CHANNELS.ENTITY_IMPORT, async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }

    try {
      const raw = readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(raw) as unknown

      const schema = z.object({
        version: z.literal(1),
        entries: z.array(z.object({
          originalText: z.string().min(1).max(500),
          pseudonym: z.string().min(1).max(200),
          type: z.string(),
        })).max(10000),
      })
      const validated = schema.safeParse(data)
      if (!validated.success) return { error: 'File non valido o formato non riconosciuto.' }

      const validEntries = validated.data.entries.filter((e) => EntityTypeEnum.safeParse(e.type).success)
      sessionManager.importEntries(validEntries as EntityDictionaryFile['entries'])

      log.info('Dizionario entità importato', { imported: validEntries.length, total: validated.data.entries.length })
      return {
        imported: validEntries.length,
        entries: validEntries.map((e) => ({ ...e, id: crypto.randomUUID() })),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('dictionary-import-failed', {
        stage: 'session',
        errorCode: safeErrorCode(err),
      })
      return { error: `Errore durante l'importazione: ${message}` }
    }
  })

  // Handler: salva sessione su disco manualmente
  ipcMain.handle(IPC_CHANNELS.SESSION_SAVE, () => {
    try {
      sessionManager.saveToDisk(getSessionDictPath())
      return { status: 'ok' }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Handler: carica sessione da disco
  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD, () => {
    const entities = sessionManager.loadFromDisk(getSessionDictPath())
    if (!entities) return null
    return { entities }
  })

  // Handler: verifica se esiste una sessione salvata
  ipcMain.handle(IPC_CHANNELS.SESSION_HAS_SAVED, () => {
    return { exists: sessionManager.hasSavedSession(getSessionDictPath()) }
  })

  // Handler: elimina la sessione salvata su disco
  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, () => {
    try {
      sessionManager.deleteSavedSession(getSessionDictPath())
      return { status: 'ok' }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Handler: restituisce il path del file sessione
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_PATH, () => {
    return { path: getSessionDictPath() }
  })

  // Handler: apre la cartella del file nel Finder/Explorer
  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Handler: restituisce la versione dell'app al renderer
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())

  // Handler: raccoglie diagnostica installazione e la copia negli appunti
  ipcMain.handle(IPC_CHANNELS.DIAG_COLLECT, async () => {
    const modelPath = getModelPath()
    const platform = process.platform
    const arch = process.arch
    const version = app.getVersion()

    // Verifica file critici
    const tessdataPath = getTessdataPath()
    const modelExists = existsSync(join(modelPath, 'onnx', 'model_quantized.onnx'))
    const tessdataExists = existsSync(join(tessdataPath, 'ita.traineddata'))
    const bindingExists = existsSync(join(
      app.getAppPath(), '..', 'app.asar.unpacked', 'node_modules',
      'onnxruntime-node', 'bin', 'napi-v3', platform, arch, 'onnxruntime_binding.node'
    ))
    const detectLibcExists = existsSync(join(
      app.getAppPath(), '..', 'app.asar.unpacked', 'node_modules', 'detect-libc'
    ))

    const diagText = formatInstallationDiagnostics({
      version,
      platform,
      arch,
      modelExists,
      tessdataExists,
      bindingExists,
      detectLibcExists,
    })

    clipboard.writeText(diagText)
    log.info('Diagnostica raccolta e copiata negli appunti')
    return diagText
  })

  // Handler: verifica presenza modello NER + tessdata OCR
  ipcMain.handle(IPC_CHANNELS.MODEL_STATUS, () => {
    const modelPath = getModelPath()
    const tessdataPath = getTessdataPath()
    const nerExists = existsSync(join(modelPath, 'onnx', 'model_quantized.onnx'))
    const tessdataExists = existsSync(join(tessdataPath, 'ita.traineddata'))
    return {
      nerExists,
      tessdataExists,
      exists: nerExists && tessdataExists,
      modelPath,
      tessdataPath
    }
  })

  // Handler: scarica modello NER da HuggingFace + tessdata OCR da GitHub
  // I file vengono salvati in app.getPath('userData') (sempre scrivibile)
  ipcMain.handle(IPC_CHANNELS.MODEL_DOWNLOAD, async (_event) => {
    const modelPath = getModelDownloadPath()
    const tessdataPath = getTessdataDownloadPath()

    const HF_BASE = 'https://huggingface.co/Laibniz/italian-ner-pii-browser-distilbert/resolve/main'
    const TESS_URL = 'https://github.com/tesseract-ocr/tessdata/raw/main/ita.traineddata'

    const FILES = [
      { remote: `${HF_BASE}/onnx/model_quantized.onnx`, local: join(modelPath, 'onnx', 'model_quantized.onnx') },
      { remote: `${HF_BASE}/tokenizer.json`,            local: join(modelPath, 'tokenizer.json') },
      { remote: `${HF_BASE}/tokenizer_config.json`,     local: join(modelPath, 'tokenizer_config.json') },
      { remote: `${HF_BASE}/config.json`,               local: join(modelPath, 'config.json') },
      { remote: TESS_URL,                               local: join(tessdataPath, 'ita.traineddata') },
    ]

    function sendProgress(file: string, percent: number, done: boolean, error?: string): void {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.webContents.send(IPC_CHANNELS.MODEL_DOWNLOAD_PROGRESS, { file, percent, done, error })
      }
    }

    function downloadFile(url: string, destPath: string, onPercent: (p: number) => void): Promise<void> {
      return new Promise((resolve, reject) => {
        mkdirSync(require('path').dirname(destPath), { recursive: true })
        const file = createWriteStream(destPath)
        const doGet = (targetUrl: string): void => {
          https.get(targetUrl, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
              res.resume()
              // Risolvi redirect relativi (es. HuggingFace restituisce path senza host)
              const redirectUrl = new URL(res.headers.location, targetUrl).href
              doGet(redirectUrl)
              return
            }
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode ?? 'unknown'} per ${targetUrl}`))
              return
            }
            const total = parseInt(res.headers['content-length'] ?? '0', 10)
            let received = 0
            res.on('data', (chunk: Buffer) => {
              received += chunk.length
              if (total > 0) onPercent(Math.round((received / total) * 100))
            })
            res.pipe(file)
            res.on('error', reject)
            file.on('finish', () => file.close(() => resolve()))
            file.on('error', reject)
          }).on('error', reject)
        }
        doGet(url)
      })
    }

    try {
      for (let i = 0; i < FILES.length; i++) {
        const { remote, local } = FILES[i]
        const fileName = local.split('/').pop() ?? remote
        const basePercent = Math.round((i / FILES.length) * 100)
        const nextPercent = Math.round(((i + 1) / FILES.length) * 100)
        sendProgress(fileName, basePercent, false)
        await downloadFile(remote, local, (filePercent) => {
          const global = basePercent + Math.round((filePercent / 100) * (nextPercent - basePercent))
          sendProgress(fileName, global, false)
        })
        log.info('model-file-downloaded', { count: i + 1, total: FILES.length })
      }
      resetNerPipeline()
      sendProgress('', 100, true)
      log.info('models-downloaded-and-pipeline-reset', {
        modelExists: true,
        tessdataExists: true,
      })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('model-download-failed', {
        stage: 'download',
        errorCode: safeErrorCode(err),
      })
      sendProgress('', 0, true, message)
      return { ok: false, error: message }
    }
  })

  log.info('IPC handlers registrati')
}
