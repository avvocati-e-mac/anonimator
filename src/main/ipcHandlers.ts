import { ipcMain, BrowserWindow, shell } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC_CHANNELS } from '@shared/types'
import { analyzeText } from './services/nerService'
import { sessionManager } from './services/sessionManager'
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

    try {
      // Fase 1: rilevamento formato e parsing
      sendProgress('parsing', 10, 'Lettura documento...')
      const format = detectFormat(filePath)
      log.info('Inizio elaborazione documento', { format })

      sendProgress('parsing', 30, 'Estrazione testo...')
      const { text, pageCount, warnings: parseWarnings } = await extractText(filePath, format)

      // Fase 2: analisi NER
      sendProgress('ner', 50, 'Riconoscimento entità...')
      const { entities: rawEntities, nerUsed, warnings: nerWarnings } = await analyzeText(text)

      // Assegna pseudonimi dalla sessione corrente
      sendProgress('ner', 80, 'Assegnazione pseudonimi...')
      const enrichedEntities = sessionManager.enrichEntities(rawEntities)

      sendProgress('done', 100, 'Analisi completata.')
      log.info('Documento analizzato', {
        format,
        pageCount,
        entities: enrichedEntities.length,
        nerUsed
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

  // Handler: reset sessione
  ipcMain.handle(IPC_CHANNELS.SESSION_RESET, async () => {
    sessionManager.reset()
    log.info('Sessione resettata', sessionManager.getDictionaryStats())
    return { status: 'ok' }
  })

  // Handler: apre la cartella del file nel Finder/Explorer
  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  log.info('IPC handlers registrati')
}
