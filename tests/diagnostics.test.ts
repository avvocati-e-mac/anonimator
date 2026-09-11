import { describe, expect, it } from 'vitest'
import { formatInstallationDiagnostics } from '../src/main/services/diagnostics'

const CANARY = 'PERSONA_SINTETICA_DIAGNOSTICS_CANARY'

describe('formatInstallationDiagnostics', () => {
  it('include soltanto versione, piattaforma e stati dei componenti', () => {
    const input = {
      version: '1.8.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      modelExists: true,
      tessdataExists: false,
      bindingExists: true,
      detectLibcExists: false,
      modelPath: `/Users/${CANARY}/model`,
      tessdataPath: `/Users/${CANARY}/tessdata`,
      logTail: CANARY,
    }

    const output = formatInstallationDiagnostics(input)

    expect(output).toContain('Versione: 1.8.0')
    expect(output).toContain('Piattaforma: darwin/arm64')
    expect(output).toContain('Modello NER: OK')
    expect(output).toContain('Tessdata OCR: MANCANTE')
    expect(output).not.toContain(CANARY)
    expect(output).not.toContain('Log')
  })
})
