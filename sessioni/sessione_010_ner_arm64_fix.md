# Sessione 010 — Fix NER su ARM compilato + multi-worker

## Data: 2026-03-05

## Problema analizzato

Il NER non funzionava nell'app compilata su ARM (Apple Silicon). Diagnosi completa:

### Causa principale: onnxruntime-node non in asarUnpack

`@huggingface/transformers` usa `onnxruntime-node` che carica il binario nativo con:
```js
require(`../bin/napi-v3/${process.platform}/${process.arch}/onnxruntime_binding.node`)
```
I file `.node` (e le `.dylib` collegate) **non possono essere caricati dall'interno di un archivio asar** perché Node.js usa `dlopen()` che richiede un path reale su filesystem. `onnxruntime-node` e `onnxruntime-common` non erano in `asarUnpack` → fallback silenzioso a sole regex.

### Causa secondaria: path modello sbagliato in produzione

`app.getAppPath()` in produzione punta **dentro l'asar** (`.../app.asar`), ma `extraResources` copia i modelli in `Contents/Resources/resources/` — **un livello sopra** l'asar.
- Soluzione: usare `process.resourcesPath` (= `Contents/Resources/`) che è corretto sia in dev che in prod.
- Fallback per test fuori Electron: `join(__dirname, '..', '..', '..')`

## Fix applicati

### 1. `electron-builder.config.js`
Aggiunti `onnxruntime-node` e `onnxruntime-common` ad `asarUnpack`:
```js
'node_modules/onnxruntime-node/**/*',
'node_modules/onnxruntime-common/**/*',
```

### 2. `src/main/services/nerService.ts`
- **Path modello**: `getModelPath()` usa `process.resourcesPath` invece di `app.getAppPath()`
- **Multi-threading ORT**: `intraOpNumThreads: min(4, cpus)`, `interOpNumThreads: 1`
- **Chunk paralleli**: i chunk NER sono processati in batch da 4 con `Promise.all()` invece di for-loop sequenziale
- Rimosso import inutilizzato `app` da electron

## Impatto atteso

- NER funzionante nell'app compilata ARM
- Velocità inferenza migliorata su documenti lunghi (~2-4x su M-series con 4 P-core)
- Nessuna regressione in dev mode (fallback path funziona)

## TODO prossime sessioni

- Ricostruire DMG arm64 e verificare NER nell'app installata
- Testare DOCX, ODT, TXT
- Aggiungere .md tra i formati accettati
- Fix "1 di ??" nel footer PDF
