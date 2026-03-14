import { ipcMain, BrowserWindow, shell, app, dialog, clipboard } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs'
import https from 'https'
import crypto from 'crypto'
import { IPC_CHANNELS } from '@shared/types'
import type { EntityDictionaryFile } from '@shared/types'
import { analyzeText, getModelPath, getModelDownloadPath, getTessdataPath, getTessdataDownloadPath, resetNerPipeline } from './services/nerService'
import { sessionManager } from './services/sessionManager'
import { settingsManager } from './services/settingsManager'
import { testLlmConnection, listLlmModels, SYSTEM_PROMPT_IT, SYSTEM_PROMPT_EN } from './services/llmService'
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
          const effectiveTotal = format === 'pdf' && pageCount > 0 ? pageCount : total
          const msg = format === 'pdf'
            ? `Analisi LLM: pagina ${page}/${effectiveTotal}...`
            : `Analisi LLM: chunk ${page} di ${total}...`
          sendProgress('ner', pct, msg)
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

      // Auto-save sessione su disco
      try { sessionManager.saveToDisk(getSessionDictPath()) } catch { /* ignorato */ }

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

    // Legge ultime 100 righe del log
    let logTail = '(log non disponibile)'
    try {
      const logFile = (log.transports.file as unknown as { getFile(): { path: string } }).getFile()
      const content = readFileSync(logFile.path, 'utf-8')
      logTail = content.split('\n').slice(-100).join('\n')
    } catch { /* ignorato */ }

    const diagText = [
      `=== Anonimator Diagnostica ===`,
      `Versione: ${version}`,
      `Piattaforma: ${platform}/${arch}`,
      `Modello NER: ${modelExists ? 'OK' : 'MANCANTE'} (${modelPath})`,
      `Tessdata OCR: ${tessdataExists ? 'OK' : 'MANCANTE'} (${tessdataPath})`,
      `ORT binding: ${bindingExists ? 'OK' : 'MANCANTE (o in dev mode)'}`,
      `detect-libc: ${detectLibcExists ? 'OK' : 'MANCANTE (o in dev mode)'}`,
      ``,
      `=== Log (ultime 100 righe) ===`,
      logTail
    ].join('\n')

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
        log.info('Modelli — file scaricato', { file: fileName })
      }
      resetNerPipeline()
      sendProgress('', 100, true)
      log.info('Modelli scaricati e pipeline resettata', { modelPath, tessdataPath })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Errore download modelli', { error: message })
      sendProgress('', 0, true, message)
      return { ok: false, error: message }
    }
  })

  log.info('IPC handlers registrati')
}
