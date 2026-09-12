import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => process.cwd(), isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: vi.fn() },
  shell: {},
}))

import { AnonymizeRequestSchema } from '../src/main/ipcHandlers'

const baseRequest = {
  analysisToken: 'a'.repeat(64),
  entities: [],
}

describe('AnonymizeRequestSchema — modalità PDF', () => {
  it('usa preserve-color quando la preferenza è assente', () => {
    expect(AnonymizeRequestSchema.parse(baseRequest).pdfOutputMode).toBe('preserve-color')
  })

  it('accetta esclusivamente la scelta bitonale semantica', () => {
    expect(AnonymizeRequestSchema.parse({
      ...baseRequest,
      pdfOutputMode: 'force-bitonal',
    }).pdfOutputMode).toBe('force-bitonal')

    expect(AnonymizeRequestSchema.safeParse({
      ...baseRequest,
      pdfOutputMode: 'bitonal-force',
    }).success).toBe(false)
  })

  it('rifiuta l’iniezione di parametri interni del codec', () => {
    expect(AnonymizeRequestSchema.safeParse({
      ...baseRequest,
      pdfOutputMode: 'force-bitonal',
      threshold: 120,
    }).success).toBe(false)
  })
})
