# Sessione 015 — Concorrenza batch con MAX_CONCURRENCY e retry automatico

**Data:** 2026-03-06
**Versione:** 1.0.3 → 1.0.4

## Obiettivo

Aggiungere concorrenza configurabile alla fase di anonimizzazione batch e retry automatico (3× / 500ms) per entrambe le fasi (NER e anonimizzazione). La fase NER rimane seriale (singleton ONNX non thread-safe), la fase di anonimizzazione diventa parallela con `p-queue`.

## Decisioni architetturali

- **p-queue** installata come dipendenza ESM pura, importata dinamicamente nel main process.
- **Coda NER seriale**: singleton `_nerQueue` con `concurrency: 1` inizializzato lazy, protezione del modello ONNX.
- **Coda anonimizzazione parallela**: `new PQueue({ concurrency: maxConcurrency })` creata per ogni invocazione di `BATCH_ANONYMIZE`, con `maxConcurrency` letta da `settingsManager`.
- **Retry**: `MAX_RETRIES = 3`, `RETRY_DELAY_MS = 500`. Per l'analisi NER, dopo 3 fallimenti restituisce `{ error }` → il renderer mostra il dialog esistente (Riprova/Salta). Per l'anonimizzazione, dopo 3 fallimenti il file è incluso nei risultati con `error`.

## File modificati

| File | Modifica |
|------|---------|
| `src/shared/types.ts` | Aggiunto `BatchSettings` + `DEFAULT_BATCH_SETTINGS` |
| `src/main/services/settingsManager.ts` | Esteso `AppSettings` con `batch`; aggiunti `getBatchSettings()` / `setBatchSettings()`; merge retrocompatibile al caricamento |
| `src/main/ipcHandlers.ts` | Aggiunti `sleep`, `MAX_RETRIES`, `RETRY_DELAY_MS`, `getNerQueue()` singleton; `DOC_PROCESS` wrappato in NER queue + retry; `SETTINGS_GET` esteso con `batch`; `SETTINGS_SET` accetta `llm?` e `batch?` separatamente con Zod; `BATCH_ANONYMIZE` sostituisce loop for con p-queue parallela + retry; rimosso `import '@shared/types'.DetectedEntity` inline (ora importato in testa) |
| `src/renderer/src/env.d.ts` | `getSettings` ritorna `{ llm, batch }`; `setSettings` accetta `{ llm?, batch? }` |
| `src/renderer/src/components/SettingsScreen.tsx` | Aggiunto stato `batch`; caricato da `getSettings`; sezione UI "Elaborazione batch" con slider 1–8; `handleSave` passa `{ llm, batch }` |
| `package.json` | `p-queue ^9.1.0` aggiunto; versione `1.0.3 → 1.0.4` |
| `CHANGELOG.md` | Sezione `## [1.0.4]` aggiunta in cima |

## Test

- `npm run typecheck` → 0 errori
- `npm test` → 39/44 test passano; 5 fallimenti in `sessionManager.test.ts` sono pre-esistenti (testano il vecchio formato `SOGGETTO_001` ma l'implementazione usa iniziali `M. R.` dal sessione 007)

## Stato prossime sessioni

- [ ] Correggere i 5 test obsoleti di `sessionManager.test.ts` (aggiornare le aspettative al formato iniziali)
- [ ] Testare DOCX, ODT, TXT e aggiungere supporto `.md`
- [ ] Fix "1 di ??" nel footer (pdf-lib non legge totale pagine)
- [ ] Ricostruire DMG arm64 con NER funzionante
