import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalysisRegistry, AnalysisTokenError } from '../src/main/services/analysisRegistry'

const directories: string[] = []

async function source(contents = 'Mario Rossi'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'anonimator-token-'))
  directories.push(directory)
  const path = join(directory, 'documento.txt')
  await writeFile(path, contents)
  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function registration(filePath: string, ownerWebContentsId = 7) {
  return {
    ownerWebContentsId,
    filePath,
    format: 'txt' as const,
    pageCount: 1,
    isScanned: false,
    entities: [{
      id: 'entity-1',
      type: 'PERSONA' as const,
      originalText: 'Mario Rossi',
      pseudonym: 'M. R.',
      occurrences: 1,
      confirmed: true,
    }],
  }
}

describe('AnalysisRegistry', () => {
  it('emette token casuali a 256 bit e conserva ledger Main-only', async () => {
    const registry = new AnalysisRegistry()
    const filePath = await source()
    const record = await registry.register(registration(filePath))
    expect(record.token).toMatch(/^[a-f0-9]{64}$/)
    expect(record.entityLedger.get('entity-1')?.expectedOccurrences).toBe(1)
  })

  it('nega token di un altra finestra', async () => {
    const registry = new AnalysisRegistry()
    const record = await registry.register(registration(await source()))
    await expect(registry.resolveForSave(record.token, 8)).rejects.toMatchObject({
      code: 'token-owner-mismatch',
    })
  })

  it('invalida il token se cambia la sorgente', async () => {
    const registry = new AnalysisRegistry()
    const filePath = await source()
    const record = await registry.register(registration(filePath))
    await writeFile(filePath, 'Lucia Bianchi -- contenuto cambiato')
    await expect(registry.resolveForSave(record.token, 7)).rejects.toMatchObject({ code: 'source-changed' })
    await expect(registry.resolveForSave(record.token, 7)).rejects.toBeInstanceOf(AnalysisTokenError)
  })

  it('sostituisce il token precedente per stessa finestra e sorgente', async () => {
    const registry = new AnalysisRegistry()
    const filePath = await source()
    const first = await registry.register(registration(filePath))
    const second = await registry.register(registration(filePath))
    expect(registry.size()).toBe(1)
    await expect(registry.resolveForSave(first.token, 7)).rejects.toMatchObject({ code: 'unknown-token' })
    await expect(registry.resolveForSave(second.token, 7)).resolves.toMatchObject({ token: second.token })
  })

  it('rifiuta la falsificazione di tipo o testo per un ID noto', async () => {
    const registry = new AnalysisRegistry()
    const record = await registry.register(registration(await source()))
    expect(() => registry.validateDecisions(record, [{
      entityId: 'entity-1',
      type: 'IBAN',
      originalText: 'Mario Rossi',
      pseudonym: 'IBAN_001',
      confirmed: true,
    }])).toThrowError(AnalysisTokenError)
  })
})
