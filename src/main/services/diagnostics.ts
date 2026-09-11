export interface InstallationDiagnostics {
  version: string
  platform: NodeJS.Platform
  arch: string
  modelExists: boolean
  tessdataExists: boolean
  bindingExists: boolean
  detectLibcExists: boolean
}

/**
 * Costruisce il testo condivisibile senza accettare log, percorsi o altri dati
 * liberi. Eventuali proprietà aggiuntive presenti a runtime vengono ignorate.
 */
export function formatInstallationDiagnostics({
  version,
  platform,
  arch,
  modelExists,
  tessdataExists,
  bindingExists,
  detectLibcExists,
}: InstallationDiagnostics): string {
  return [
    '=== Anonimator Diagnostica ===',
    `Versione: ${version}`,
    `Piattaforma: ${platform}/${arch}`,
    `Modello NER: ${modelExists ? 'OK' : 'MANCANTE'}`,
    `Tessdata OCR: ${tessdataExists ? 'OK' : 'MANCANTE'}`,
    `ORT binding: ${bindingExists ? 'OK' : 'MANCANTE (o in dev mode)'}`,
    `detect-libc: ${detectLibcExists ? 'OK' : 'MANCANTE (o in dev mode)'}`,
  ].join('\n')
}
