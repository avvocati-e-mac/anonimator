import { ipcMain, BrowserWindow, shell, app, dialog } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { IPC_CHANNELS } from '@shared/types'
import type { EntityDictionaryFile, DetectedEntity, EntityType, DocumentFormat, NerTiming, ElaborationStats } from '@shared/types'
import { analyzeText } from './services/nerService'
import { sessionManager } from './services/sessionManager'
import { settingsManager } from './services/settingsManager'
import { testLlmConnection, listLlmModels, SYSTEM_PROMPT_IT, SYSTEM_PROMPT_EN } from './services/llmService'
import { statsManager } from './services/statsManager'
import { detectFormat, extractText } from './parsers/index'
import { generateOutput } from './outputGenerators/index'

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
    )
})

const AnonymizeRequestSchema = z.object({
  filePath: z.string().min(1),
  entities: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      originalText: z.string(),
      pseudonym: z.string(),
      occurrences: z.number().int().nonnegative(),
      confirmed: z.boolean()
    })
  )
})

const EntityTypeEnum = z.enum([
  'PERSONA', 'ORGANIZZAZIONE', 'LUOGO', 'CODICE_FISCALE',
  'PARTITA_IVA', 'IBAN', 'EMAIL', 'TELEFONO', 'DATA_NASCITA', 'INDIRIZZO', 'NUMERO_DOCUMENTO'
])

const LlmConfigSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().min(1),
  model: z.string(),
  maxTokens: z.number().int().min(256).max(32768),
  timeoutMs: z.number().int().min(5000).max(600000),
  parallelRequests: z.number().int().min(1).max(4),
  customPrompt: z.string().optional(),
  // TODO [A/B-TEST]: rimuovere promptLanguage dopo ottimizzazione prompt
  promptLanguage: z.enum(['it', 'en']).default('it'),
  chunkSize: z.number().int().min(1000).max(8000).default(3000)
})

// ─── Helper: invia progresso alla finestra attiva ─────────────────────────────
function sendProgress(stage: string, percent: number, message: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send(IPC_CHANNELS.DOC_PROGRESS, { stage, percent, message })
  }
}

// ─── Dati pendenti per stats (tra DOC_PROCESS e DOC_ANONYMIZE) ────────────────

interface PendingStatsData {
  totalStart: number
  parsingMs: number
  timing: NerTiming
  text: string
  enrichedEntities: DetectedEntity[]
  pageCount: number
  format: DocumentFormat
  parseWarnings: string[]
  nerWarnings: string[]
  nerUsed: boolean
  llmUsed: boolean
}

const pendingStats = new Map<string, PendingStatsData>()

function computeByType(entities: DetectedEntity[]): Partial<Record<EntityType, number>> {
  const result: Partial<Record<EntityType, number>> = {}
  for (const e of entities) {
    result[e.type] = (result[e.type] ?? 0) + 1
  }
  return result
}

// ─── Registrazione handler ────────────────────────────────────────────────────

export function registerIpcHandlers(): void {

  // Handler: avvia analisi documento
  ipcMain.handle(IPC_CHANNELS.DOC_PROCESS, async (_event, payload: unknown) => {
    const parsed = ProcessDocumentSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC doc:process — payload non valido', parsed.error.flatten())
      return { error: 'Formato file non supportato o percorso non valido.' }
    }

    const { filePath } = parsed.data
    const llmConfig = settingsManager.getLlmConfig()

    const totalStart = performance.now()

    try {
      // Fase 1: rilevamento formato e parsing
      sendProgress('parsing', 10, 'Lettura documento...')
      const format = detectFormat(filePath)
      log.info('Inizio elaborazione documento', { format })

      const parsingStart = performance.now()
      sendProgress('parsing', 30, 'Estrazione testo...')
      const { text, pageCount, warnings: parseWarnings } = await extractText(filePath, format)
      const parsingMs = performance.now() - parsingStart

      // Fase 2: analisi NER (BERT + regex, opzionalmente LLM)
      sendProgress('ner', 50, 'Riconoscimento entità...')
      if (llmConfig.enabled && llmConfig.model) {
        sendProgress('ner', 50, 'Riconoscimento entità (BERT + LLM)...')
      }
      const { entities: rawEntities, nerUsed, llmUsed, warnings: nerWarnings, timing } =
        await analyzeText(text, llmConfig, (page, total) => {
          const pct = 50 + Math.round((page / total) * 30)
          sendProgress('ner', pct, `Analisi LLM: pagina ${page}/${total}...`)
        })

      // Assegna pseudonimi dalla sessione corrente
      sendProgress('ner', 85, 'Assegnazione pseudonimi...')
      const enrichedEntities = sessionManager.enrichEntities(rawEntities)

      sendProgress('done', 100, 'Analisi completata.')
      log.info('Documento analizzato', {
        format,
        pageCount,
        entities: enrichedEntities.length,
        nerUsed,
        llmUsed
      })

      // Salva dati pendenti per calcolo stats in DOC_ANONYMIZE
      pendingStats.set(filePath, {
        totalStart,
        parsingMs,
        timing,
        text,
        enrichedEntities,
        pageCount,
        format,
        parseWarnings,
        nerWarnings,
        nerUsed,
        llmUsed,
      })

      return {
        fileName: filePath.split('/').pop() ?? filePath,
        format,
        pageCount,
        entities: enrichedEntities,
        warnings: [...parseWarnings, ...nerWarnings]
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Errore elaborazione documento', { error: message })
      return { error: `Errore durante l'elaborazione: ${message}` }
    }
  })

  // Handler: avvia anonimizzazione dopo conferma utente
  ipcMain.handle(IPC_CHANNELS.DOC_ANONYMIZE, async (_event, payload: unknown) => {
    const parsed = AnonymizeRequestSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC doc:anonymize — payload non valido', parsed.error.flatten())
      return { error: 'Dati non validi.' }
    }

    const { filePath, entities } = parsed.data
    const confirmed = entities.filter((e) => e.confirmed)
    const format = detectFormat(filePath)

    try {
      sendProgress('parsing', 20, 'Preparazione anonimizzazione...')
      log.info('Anonimizzazione richiesta', { format, entitiesConfirmed: confirmed.length })

      const anonStart = performance.now()
      sendProgress('parsing', 50, 'Sostituzione entità...')
      const typedEntities = entities as DetectedEntity[]
      const { outputPath, entitiesReplaced } = await generateOutput(filePath, format, typedEntities)
      const anonMs = performance.now() - anonStart

      // Aggiorna il sessionManager con i pseudonimi confermati
      for (const entity of typedEntities.filter((e) => e.confirmed)) {
        sessionManager.getOrCreatePseudonym(entity.originalText, entity.type)
      }

      sendProgress('done', 100, 'Anonimizzazione completata.')
      log.info('Documento anonimizzato', { outputPath, entitiesReplaced })

      // Auto-save sessione su disco
      try { sessionManager.saveToDisk(getSessionDictPath()) } catch { /* ignorato */ }

      // ── Registra stats ──────────────────────────────────────────────────────
      const pending = pendingStats.get(filePath)
      if (pending) {
        pendingStats.delete(filePath)
        const totalMs = performance.now() - pending.totalStart
        const pc = pending.pageCount || 1

        const stats: ElaborationStats = {
          fileName: filePath.split('/').pop()?.split('\\').pop() ?? filePath,
          format: pending.format,
          processedAt: new Date().toISOString(),
          pageCount: pending.pageCount,
          textLength: pending.text.length,
          textLengthPerPage: Math.round(pending.text.length / pc),
          entitiesFound: pending.enrichedEntities.length,
          entitiesConfirmed: confirmed.length,
          entitiesReplaced,
          entitiesByType: computeByType(pending.enrichedEntities),
          phases: {
            parsing:       { durationMs: Math.round(pending.parsingMs) },
            nerRegex:      { durationMs: pending.timing.regexMs },
            nerBert:       { durationMs: pending.timing.bertMs },
            ...(pending.timing.llmMs > 0 ? { llm: { durationMs: pending.timing.llmMs } } : {}),
            anonymization: { durationMs: Math.round(anonMs) },
            total:         { durationMs: Math.round(totalMs) },
          },
          msPerPage:         Math.round(totalMs / pc),
          entitiesPerSecond: pending.timing.bertMs > 0
            ? Math.round(pending.enrichedEntities.length / (pending.timing.bertMs / 1000) * 10) / 10
            : 0,
          llm: pending.timing.llm ? { ...pending.timing.llm, durationMs: pending.timing.llmMs } : undefined,
          nerUsed: pending.nerUsed,
          llmUsed: pending.llmUsed,
          warnings: [...pending.parseWarnings, ...pending.nerWarnings],
        }
        statsManager.record(stats)
      }

      return { outputPath, entitiesReplaced }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Errore anonimizzazione', { error: message })
      return { error: `Errore durante l'anonimizzazione: ${message}` }
    }
  })

  // Handler: anonimizzazione batch (N file in sequenza)
  ipcMain.handle(IPC_CHANNELS.BATCH_ANONYMIZE, async (_event, payload: unknown) => {
    const RequestSchema = z.array(AnonymizeRequestSchema)
    const parsed = RequestSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC batch:anonymize — payload non valido', parsed.error.flatten())
      return []
    }

    const results: import('@shared/types').BatchResultItem[] = []

    for (const req of parsed.data) {
      const { filePath, entities } = req
      const format = detectFormat(filePath)
      const fileName = filePath.split('/').pop() ?? filePath
      const confirmed = entities.filter((e) => e.confirmed)

      try {
        sendProgress('parsing', 0, `Anonimizzazione: ${fileName}...`)
        const typedEntities = entities as DetectedEntity[]

        const anonStart = performance.now()
        const { outputPath, entitiesReplaced } = await generateOutput(filePath, format, typedEntities)
        const anonMs = performance.now() - anonStart

        for (const entity of typedEntities.filter((e) => e.confirmed)) {
          sessionManager.getOrCreatePseudonym(entity.originalText, entity.type)
        }

        log.info('Batch: documento anonimizzato', { fileName, outputPath, entitiesReplaced })
        results.push({ filePath, fileName, outputPath, entitiesReplaced })

        // ── Registra stats per questo file del batch ──────────────────────────
        const pending = pendingStats.get(filePath)
        if (pending) {
          pendingStats.delete(filePath)
          const totalMs = performance.now() - pending.totalStart
          const pc = pending.pageCount || 1

          const stats: ElaborationStats = {
            fileName: filePath.split('/').pop()?.split('\\').pop() ?? filePath,
            format: pending.format,
            processedAt: new Date().toISOString(),
            pageCount: pending.pageCount,
            textLength: pending.text.length,
            textLengthPerPage: Math.round(pending.text.length / pc),
            entitiesFound: pending.enrichedEntities.length,
            entitiesConfirmed: confirmed.length,
            entitiesReplaced,
            entitiesByType: computeByType(pending.enrichedEntities),
            phases: {
              parsing:       { durationMs: Math.round(pending.parsingMs) },
              nerRegex:      { durationMs: pending.timing.regexMs },
              nerBert:       { durationMs: pending.timing.bertMs },
              ...(pending.timing.llmMs > 0 ? { llm: { durationMs: pending.timing.llmMs } } : {}),
              anonymization: { durationMs: Math.round(anonMs) },
              total:         { durationMs: Math.round(totalMs) },
            },
            msPerPage:         Math.round(totalMs / pc),
            entitiesPerSecond: pending.timing.bertMs > 0
              ? Math.round(pending.enrichedEntities.length / (pending.timing.bertMs / 1000) * 10) / 10
              : 0,
            llm: pending.timing.llm ? { ...pending.timing.llm, durationMs: pending.timing.llmMs } : undefined,
            nerUsed: pending.nerUsed,
            llmUsed: pending.llmUsed,
            warnings: [...pending.parseWarnings, ...pending.nerWarnings],
          }
          statsManager.record(stats)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('Batch: errore anonimizzazione', { fileName, error: message })
        results.push({ filePath, fileName, error: message })
        pendingStats.delete(filePath) // pulizia
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
    log.info('Sessione resettata', sessionManager.getDictionaryStats())
    return { status: 'ok' }
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
    const body = payload as { baseUrl?: string; timeoutMs?: number }
    if (!body?.baseUrl) return { models: [] }
    const models = await listLlmModels({ baseUrl: body.baseUrl, timeoutMs: body.timeoutMs ?? 10000 })
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
      }))
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'Dati non validi.' }

    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'dizionario-entita.json',
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
      log.error('Errore importazione dizionario', { error: message })
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

  // Handler: restituisce tutte le stats di elaborazione
  ipcMain.handle(IPC_CHANNELS.STATS_GET_ALL, () => statsManager.getAll())

  // Handler: cancella tutte le stats
  ipcMain.handle(IPC_CHANNELS.STATS_CLEAR, () => {
    statsManager.clear()
    return { status: 'ok' }
  })

  log.info('IPC handlers registrati')
}
