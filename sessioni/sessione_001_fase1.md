# Sessione 001 — Fase 1: Setup & Scaffolding
**Data:** 2026-03-05
**Stato:** COMPLETATA

## Decisioni prese

### NER Engine: cambio rispetto al piano originale
- Piano originale: modello ONNX generico (Xenova)
- **Decisione adottata:** usare `DeepMount00/Italian_NER_XXL_v2` via Transformers.js
- Motivazione: 52 categorie legali italiane specifiche (AVV_NOTAIO, TRIBUNALE, N_SENTENZA, LEGGE...), BERT-based, veloce su CPU, zero allucinazioni, bundle nell'app
- Ollama/LLM locali scartati: troppo pesanti per utenti non tecnici, lenti su CPU, richiedono installazione separata

### Vite: versione downgrade
- electron-vite 2.3 richiede Vite ^4 o ^5 (non supporta Vite 6)
- Usato Vite 5.4.x

## File creati nella Fase 1
- `package.json` — aggiornato con tutte le dipendenze corrette
- `tsconfig.json` — TypeScript strict mode
- `electron.vite.config.ts` — build config per main/preload/renderer
- `tailwind.config.js` + `postcss.config.js`
- `src/shared/types.ts` — IPC_CHANNELS, EntityType, DetectedEntity, IPC contracts
- `src/main/index.ts` — BrowserWindow con sicurezza (sandbox, contextIsolation, nodeIntegration=false)
- `src/main/ipcHandlers.ts` — stub handler doc:process, doc:anonymize, session:reset con Zod
- `src/preload/index.ts` — contextBridge con 4 funzioni: processDocument, anonymizeDocument, resetSession, onProgress
- `src/renderer/index.html` — CSP header che blocca connect-src
- `src/renderer/src/main.tsx` — React entry point
- `src/renderer/src/App.tsx` — placeholder schermata
- `src/renderer/src/env.d.ts` — tipizzazione Window.electronAPI
- `src/renderer/src/index.css` — Tailwind base

## Stato cartelle resources
- `resources/models/` — vuota, da popolare con il modello ONNX nella Fase 2
- `resources/tessdata/` — vuota, da popolare con ita.traineddata nella Fase 4

## Git
- Commit iniziale: `6e8a70c` — file originali
- Commit Fase 1: `9eb389f` — scaffolding completo

## Prossimo: Fase 2
- NER Engine: nerService.ts con Italian_NER_XXL_v2 + regex italiani
- SessionManager: dizionario pseudonimi in memoria
- Download/conversione modello ONNX da HuggingFace
