import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC_CHANNELS } from '@shared/types'

// Schema di validazione per la richiesta di processing
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

// Schema di validazione per la richiesta di anonimizzazione
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

export function registerIpcHandlers(): void {
  // Handler: avvia analisi documento
  ipcMain.handle(IPC_CHANNELS.DOC_PROCESS, async (_event, payload: unknown) => {
    const parsed = ProcessDocumentSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC doc:process — payload non valido', parsed.error.flatten())
      return { error: parsed.error.flatten().fieldErrors }
    }

    const { filePath } = parsed.data
    log.info('Richiesta analisi documento', {
      ext: filePath.split('.').pop(),
      size: 'N/A' // sarà popolato dai parser
    })

    // TODO Fase 2: chiamare nerService
    // TODO Fase 3-4: chiamare i parser
    return { status: 'ok', message: 'Handler registrato (implementazione Fase 2-4)' }
  })

  // Handler: avvia anonimizzazione dopo conferma utente
  ipcMain.handle(IPC_CHANNELS.DOC_ANONYMIZE, async (_event, payload: unknown) => {
    const parsed = AnonymizeRequestSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('IPC doc:anonymize — payload non valido', parsed.error.flatten())
      return { error: parsed.error.flatten().fieldErrors }
    }

    log.info('Richiesta anonimizzazione', {
      entitiesConfirmed: parsed.data.entities.filter((e) => e.confirmed).length
    })

    // TODO Fase 3-4: chiamare outputGenerators
    return { status: 'ok', message: 'Handler registrato (implementazione Fase 3-4)' }
  })

  // Handler: reset sessione (svuota dizionario pseudonimi)
  ipcMain.handle(IPC_CHANNELS.SESSION_RESET, async () => {
    log.info('Reset sessione richiesto')
    // TODO Fase 2: chiamare sessionManager.reset()
    return { status: 'ok' }
  })

  log.info('IPC handlers registrati')
}
