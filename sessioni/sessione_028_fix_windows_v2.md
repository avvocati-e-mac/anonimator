# Sessione 028 — Fix Windows 10 onnxruntime crash (v2) — v1.1.4

**Data:** 2026-03-07
**Versione:** 1.1.3 → 1.1.4

---

## Problema

Su Windows 10 con v1.1.2 e v1.1.3, l'app crasha all'avvio:
```
Error: Impossibile trovare il modulo specificato.
\\?\C:\Users\andrea\AppData\Local\Programs\Anonimator\resources\app.asar.unpacked\node_modules\onnxruntime-node\bin\napi-v3\win32\x64\onnxruntime_binding.node
    at Object.<anonymous> (C:\...\app.asar\node_modules\onnxruntime-node\dist\binding.js:10:1)
```

## Diagnosi

- Il file `.node` è fisicamente in `app.asar.unpacked` (asarUnpack funziona per i binari nativi).
- Ma `binding.js` rimane **dentro** `app.asar` — quando fa `require('../bin/...')`, `__dirname` punta a `app.asar/node_modules/onnxruntime-node/dist/` e Node cerca il `.node` dentro `app.asar`.
- Su macOS/Win11, Electron fa il fallover automatico su `app.asar.unpacked`; su Win10 questo fallover non avviene per i file `.node` caricati via `dlopen()`.
- La patch `Module._resolveFilename` di v1.1.2 intercettava solo il livello JS, non il livello C++ di `dlopen()`.

## Soluzioni implementate

### Fix 1 — electron-builder.config.js: asarUnpack più esplicito

Pattern aggiunto/modificato per `onnxruntime-node`:
```javascript
'node_modules/onnxruntime-node/**',        // glob ampio (senza /* finale)
'node_modules/onnxruntime-node/dist/**',   // esplicito per dist/binding.js
```

Il pattern `**/*` in electron-builder può non estrarre file nella root di sottodirectory.
Con `**` (senza `/*`) e il pattern esplicito `dist/**`, tutti i file JS compresi `dist/binding.js` e `package.json` finiscono in `app.asar.unpacked`.

### Fix 2 — nerService.ts: import dinamico con graceful degradation

Rimosso l'import statico top-level:
```typescript
import { pipeline, env } from '@huggingface/transformers'  // RIMOSSO
```

Aggiunta funzione `tryLoadTransformers()` con `await import(...)` e try/catch:
- Se onnxruntime carica → NER BERT disponibile come prima
- Se onnxruntime crasha → errore loggato, app sopravvive con solo regex
- `env.allowRemoteModels = false` / `env.allowLocalModels = true` spostati dentro la funzione

`getNerPipeline()` ora chiama `tryLoadTransformers()` prima di tentare il caricamento del modello.

## File modificati

| File | Modifica |
|------|----------|
| `electron-builder.config.js` | Pattern asarUnpack onnxruntime-node esteso |
| `src/main/services/nerService.ts` | Import dinamico + tryLoadTransformers() |
| `package.json` | Bump 1.1.3 → 1.1.4 |
| `CHANGELOG.md` | Sezione v1.1.4 |

## Verifica

- `npm run typecheck` → nessun errore ✅

## Test diagnostico per Andrea (prima del tag)

Verificare se esiste:
`C:\Users\andrea\AppData\Local\Programs\Anonimator\resources\app.asar.unpacked\node_modules\onnxruntime-node\dist\binding.js`

- Se `dist/` NON esiste → Fix 1 risolve il problema (asarUnpack incompleto confermato)
- Se `dist/` esiste → il problema è DLL mancanti (Visual C++ Redistributable 2022 x64)

## Prossimi passi

1. Commit + tag v1.1.4 → push → CI produce Windows .exe
2. Andrea testa l'installer su Win10
3. Se NER non carica nonostante Fix 1: app mostra solo regex entities (nessun crash grazie a Fix 2)
