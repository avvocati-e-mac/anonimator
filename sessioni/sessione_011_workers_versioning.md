# Sessione 011 — Worker paralleli NER/LLM, versioning, version label UI

## Data: 2026-03-05

## Obiettivi completati

### 1. Fix NER su ARM compilato (sessione 010, continuazione)
- `onnxruntime-node` e `onnxruntime-common` aggiunti ad `asarUnpack`
- Path modello NER: `getModelPath()` usa `process.resourcesPath` in produzione, fallback a `__dirname/../..` in dev
- ORT multi-threading: `intraOpNumThreads: min(4, cpus)`, `interOpNumThreads: 1`

### 2. Fix regressione path NER in dev mode (Intel)
- `process.resourcesPath` in dev punta a `node_modules/electron/dist/.../Resources`, non alla root progetto
- Fix: `getModelPath()` controlla `existsSync(prodPath)` — se i modelli non esistono in resourcesPath usa il fallback dev
- Commit: `364bb9d2`

### 3. Worker paralleli NER
- Chunk NER processati in batch da 4 con `Promise.all()` invece di for-loop sequenziale
- Commit: `acf1745f`

### 4. Worker paralleli LLM + impostazione UI
- LLM chunks processati in batch di dimensione `llmConfig.parallelRequests` (default 1)
- `parallelRequests: number` aggiunto a `LlmConfig` in `types.ts` (default 1)
- `SettingsScreen.tsx`: slider 1–4 nelle impostazioni avanzate con etichette "Prudente → Veloce"
- Spiegazione in italiano semplice per utenti non tecnici
- Commit: `acf1745f`

### 5. Nome artifact con versione e arch
- DMG: `Anonimator-1.0.0-arm64.dmg` / `Anonimator-1.0.0-x64.dmg`
- NSIS: `Anonimator-1.0.0-windows-x64-setup.exe`
- Commit: `5215621e`

### 6. Versione app 1.0.1
- `package.json` e `package-lock.json` aggiornati con `npm install --package-lock-only`
- Commit: `14ba8611`

### 7. Versione visibile nell'UI
- Esposta via IPC (`app:getVersion`) dal main process — `app` non disponibile nel preload sandboxed
- Mostrata come `v. 1.0.1` in alto a sinistra nella DropZone
- Fix bug: primo tentativo usava `app.getVersion()` direttamente nel preload → crash silenzioso
- Commit: `61c77166` (feature) + `a297c94e` (fix IPC) + `99fd4b2f` (formato e posizione)

## File modificati
- `electron-builder.config.js` — asarUnpack + artifactName
- `src/main/services/nerService.ts` — path modello, ORT threads, batch NER, batch LLM
- `src/main/ipcHandlers.ts` — handler `app:getVersion`
- `src/preload/index.ts` — `getAppVersion` via IPC
- `src/renderer/src/env.d.ts` — tipo `getAppVersion: () => Promise<string>`
- `src/renderer/src/components/DropZone.tsx` — label versione top-left
- `src/renderer/src/components/SettingsScreen.tsx` — slider parallelRequests
- `src/shared/types.ts` — `parallelRequests` in LlmConfig, canale `APP_GET_VERSION`
- `package.json` + `package-lock.json` — versione 1.0.1

## Stato finale
- App funzionante in dev mode (Intel verificato, ARM fix applicato)
- Versione `v. 1.0.1` visibile top-left nella DropZone
- NER: 4 thread ORT + chunk in batch paralleli da 4
- LLM: batch paralleli configurabile 1–4 dalle impostazioni avanzate

## TODO prossime sessioni
- Ricostruire DMG arm64 e verificare NER nell'app installata
- Testare DOCX, ODT, TXT
- Aggiungere .md tra i formati accettati
- Fix "1 di ??" nel footer PDF
- Build Windows .exe (da fare su Windows o CI GitHub Actions)
