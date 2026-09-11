import { describe, expect, it, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DetectedEntity } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() }
}))

import { generatePdfSafe } from '../src/main/outputGenerators/pdfSafeGenerator'

const FIXTURE = join(__dirname, 'corpus-ocr', 'negativi', 'neg-02-allineato-flate.pdf')
const GATE = join(process.cwd(), 'scripts', 'verify-searchable-pdf.mjs')

describe('gate PDF ricercabile v1.7', () => {
  it('richiede Poppler e Tesseract 5 con lingua italiana', () => {
    for (const tool of ['pdftoppm', 'pdftotext', 'pdfdetach']) {
      const probe = spawnSync(tool, ['-v'], { encoding: 'utf8' })
      expect(probe.error, `${tool} non eseguibile`).toBeUndefined()
      expect(`${probe.stdout}${probe.stderr}`).toMatch(/poppler|pdf/i)
    }
    const version = execFileSync('tesseract', ['--version'], { encoding: 'utf8' })
    expect(version).toMatch(/^tesseract 5\./)
    const languages = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' })
    expect(languages.split(/\s+/)).toContain('ita')
  })

  it('un output partial resta raster-only e supera sanitizzazione e confronto visivo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-searchable-gate-'))
    const input = join(dir, 'source.pdf')
    await copyFile(FIXTURE, input)
    const missing: DetectedEntity = {
      id: 'missing-1', type: 'PERSONA', originalText: 'Persona Non Presente',
      pseudonym: 'PERSONA_999', occurrences: 1, confirmed: true
    }
    try {
      const result = await generatePdfSafe(input, [missing], {
        routing: 'flattened-scan', layerKind: 'scan-with-text', ocrAligned: true
      })
      expect(result.safetyStatus).toBe('partial')
      execFileSync(process.execPath, [GATE,
        '--source', input,
        '--visual-reference', result.outputPath,
        '--output', result.outputPath,
        '--status', 'partial',
        '--original', missing.originalText
      ], { stdio: 'pipe' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
