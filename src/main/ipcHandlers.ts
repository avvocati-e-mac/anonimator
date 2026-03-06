import { ipcMain, BrowserWindow, shell, app } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC_CHANNELS } from '@shared/types'
import type { LlmConfig } from '@shared/types'
import { analyzeText } from './services/nerService'
import { sessionManager } from './services/sessionManager'
import { settingsManager } from './services/settingsManager'
import { testLlmConnection, listLlmModels } from './services/llmService'
import { detectFormat, extractText } from './parsers/index'
import { generateOutput } from './outputGenerators/index'

// ─── Schemi di validazione Zod ────────────────────────────────────────────────

const ProcessDocumentSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .refine(
      (p) =>
        ['.pdf', '.docx', '.odt', '.txt', '.png', '.jpg', '.jpeg'].some((ext) =>
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

const LlmConfigSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().min(1),
  model: z.string(),
  maxTokens: z.number().int().min(256).max(32768),
  timeoutMs: z.number().int().min(5000).max(600000)
})

// ─── Helper: invia progresso alla finestra attiva ─────────────────────────────
function sendProgress(stage: string, percent: number, message: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send(IPC_CHANNELS.DOC_PROGRESS, { stage, percent, message })
  }
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

    try {
      // Fase 1: rilevamento formato e parsing
      sendProgress('parsing', 10, 'Lettura documento...')
      const format = detectFormat(filePath)
      log.info('Inizio elaborazione documento', { format })

      sendProgress('parsing', 30, 'Estrazione testo...')
      const { text, pageCount, warnings: parseWarnings } = await extractText(filePath, format)

      // Fase 2: analisi NER (BERT + regex, opzionalmente LLM)
      sendProgress('ner', 50, 'Riconoscimento entità...')
      if (llmConfig.enabled && llmConfig.model) {
        sendProgress('ner', 50, 'Riconoscimento entità (BERT + LLM)...')
      }
      const { entities: rawEntities, nerUsed, llmUsed, warnings: nerWarnings } =
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

      sendProgress('parsing', 50, 'Sostituzione entità...')
      const typedEntities = entities as import('@shared/types').DetectedEntity[]
      const { outputPath, entitiesReplaced } = await generateOutput(filePath, format, typedEntities)

      // Aggiorna il sessionManager con i pseudonimi confermati
      for (const entity of typedEntities.filter((e) => e.confirmed)) {
        sessionManager.getOrCreatePseudonym(entity.originalText, entity.type)
      }

      sendProgress('done', 100, 'Anonimizzazione completata.')
      log.info('Documento anonimizzato', { outputPath, entitiesReplaced })
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

      try {
        sendProgress('parsing', 0, `Anonimizzazione: ${fileName}...`)
        const typedEntities = entities as import('@shared/types').DetectedEntity[]
        const { outputPath, entitiesReplaced } = await generateOutput(filePath, format, typedEntities)

        for (const entity of typedEntities.filter((e) => e.confirmed)) {
          sessionManager.getOrCreatePseudonym(entity.originalText, entity.type)
        }

        log.info('Batch: documento anonimizzato', { fileName, outputPath, entitiesReplaced })
        results.push({ filePath, fileName, outputPath, entitiesReplaced })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('Batch: errore anonimizzazione', { fileName, error: message })
        results.push({ filePath, fileName, error: message })
      }
    }

    sendProgress('done', 100, 'Batch completato.')
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
    settingsManager.setLlmConfig(parsed.data as LlmConfig)
    return { status: 'ok' }
  })

  // Handler: testa connessione LLM
  ipcMain.handle(IPC_CHANNELS.LLM_TEST, async (_event, payload: unknown) => {
    const body = payload as { llm?: unknown }
    const parsed = LlmConfigSchema.safeParse(body?.llm)
    if (!parsed.success) {
      return { ok: false, message: 'Configurazione non valida.' }
    }
    return testLlmConnection(parsed.data as LlmConfig)
  })

  // Handler: lista modelli disponibili sul server LLM
  ipcMain.handle(IPC_CHANNELS.LLM_LIST_MODELS, async (_event, payload: unknown) => {
    const body = payload as { baseUrl?: string; timeoutMs?: number }
    if (!body?.baseUrl) return { models: [] }
    const models = await listLlmModels({ baseUrl: body.baseUrl, timeoutMs: body.timeoutMs ?? 10000 })
    return { models }
  })

  // Handler: apre la cartella del file nel Finder/Explorer
  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Handler: restituisce la versione dell'app al renderer
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())

  log.info('IPC handlers registrati')
}
