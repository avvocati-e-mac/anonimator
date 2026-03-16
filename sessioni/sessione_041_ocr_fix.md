# Sessione 041 — Fix OCR Tesseract.js path in Electron
**Data:** 2026-03-16
**Versione:** 1.3.1 → 1.3.2

## Obiettivo
Correggere il funzionamento dell'OCR (Tesseract.js v5 + MuPDF) nell'app Electron in modalità packaged:
1. Sostituire il rendering PDF da `pdfjs-dist + node-canvas` a MuPDF (nativo, già usato in pdfGenerator.ts)
2. Risolvere i path di Tesseract.js (workerPath, corePath) per `app.isPackaged === true`

## Analisi preliminare

### Stato iniziale
- `npm run typecheck`: zero errori
- `npm test`: 157/157 test passati

### Analisi `src/main/parsers/ocrParser.ts`
- `createWorker` viene chiamato con opzioni: `{ langPath, cachePath, cacheMethod: 'none', logger: () => {} }`
- **Mancanti**: `workerPath`, `corePath`, `gzip`
- `getTessdataPath()` viene importato da `nerService.ts`
- NON distingue `app.isPackaged` — stesso path in dev e packed (quello di `userData`)
- Rendering PDF: usa `pdfjs-dist` + `node-canvas` (via `require('canvas')`)
  - `node-canvas` NON è una dipendenza diretta — il catch fallisce silenziosamente in fallback
  - Questo causa OCR silenzioso su PDF scansionati: nessun rendering reale, zero testo estratto
- NON passa `workerPath`: in Electron packaged, il worker JS è dentro `app.asar.unpacked` ma Node `new Worker()` non riesce a trovarlo senza path assoluto
- NON passa `corePath`: i WASM di tesseract-core non vengono trovati inside asar
- NON imposta `gzip: false`: Tesseract.js prova a decomprimere `ita.traineddata` con gzip anche quando il file è già non-compresso (scaricato dal download manager interno), causando errori

### Analisi `src/main/services/nerService.ts`
- `getTessdataPath()` restituisce `join(app.getPath('userData'), 'tessdata')`
- NON distingue `app.isPackaged` — corretto per langPath (tessdata è sempre in userData)
- In dev: funziona perché `new Worker()` trova i file nella cartella node_modules
- In packed: il worker JS è dentro `app.asar` (o `app.asar.unpacked` se configurato) ma senza path assoluto Tesseract.js usa percorsi relativi che falliscono

### Analisi `electron-builder.config.js`
- `asarUnpack` include già:
  - `'node_modules/tesseract.js/**/*'` ✓
  - `'node_modules/tesseract.js-core/**/*'` ✓
- Questi entry sono CORRETTI — i file vengono estratti in `app.asar.unpacked`
- **Il problema**: anche se i file sono unpacked, Tesseract.js in packed non sa dove cercarli
  perché non viene passato `workerPath` e `corePath` con path assoluti calcolati a runtime

### Diagnosi problema radice
Il problema è una **combinazione** di tre issues:
1. **`workerPath` non passato** → in packed app, `new Worker()` non trova il worker JS
2. **`corePath` non passato** → Tesseract.js non trova i WASM di tesseract-core
3. **`node-canvas` non installato** → rendering PDF fallisce silenziosamente, OCR di pagine vuote
Il punto 3 era mascherato dal try/catch: il fallback al testo digitale funzionava sui PDF nativi
ma per PDF scansionati puri (nessun testo digitale) il risultato è stringa vuota.

### File fisici verificati
- `node_modules/tesseract.js/src/worker-script/node/index.js` ✓ esiste
- `node_modules/tesseract.js-core/`: contiene `tesseract-core-simd.wasm`, `tesseract-core-simd.js`, ecc.
- `node_modules/tesseract.js/src/index.d.ts`: WorkerOptions include `workerPath`, `corePath`, `gzip` ✓

### Analisi branch abbandonato `fix/ocr-mupdf-ollama-stream`
Commit rilevanti:
- `2b41cfb fix: refactor OCR with MuPDF and improve Ollama compatibility`
- `7e7762f fix: refine Tesseract path resolution with require.resolve`

Cosa era **corretto** nel branch abbandonato:
- Sostituzione pdfjs + node-canvas con MuPDF per rendering ✓
- Uso di `pathToFileURL` per `langPath` e `corePath` ✓
- Uso di `createRequire(import.meta.url)` per `_require.resolve()` ✓
- Aggiunta di `gzip: false` ✓
- Fallback digitale tramite `page.toStructuredText().asText()` ✓

Cosa NON era stato fatto nel branch abbandonato:
- Non distingueva `app.isPackaged`: in packaged app i path via `_require.resolve()` continuano
  a puntare dentro `app.asar` (non `app.asar.unpacked`) per i moduli JS (non-.node)
- `workerPath` era un filesystem path, non un `file://` URL — ma questo è corretto per workerPath
  perché Node `new Worker(path)` vuole un path, non un URL
- Il path `corePath` era corretto in dev ma in packed potrebbe puntare dentro asar

La soluzione corretta: aggiungere distinzione `app.isPackaged` per costruire i path
con `process.resourcesPath + 'app.asar.unpacked'` in modalità packaged.

## Decisioni prese
1. **Commit 1**: Replace pdfjs+node-canvas with MuPDF (stesso pattern di pdfGenerator.ts)
2. **Commit 2**: Aggiungere `resolveTesseractPaths()` con distinzione `app.isPackaged`
   - `langPath`: continua a usare `getTessdataPath()` (userData) — corretto, non cambia
   - `cachePath`: rimosso (ridondante con `cacheMethod: 'none'`)
   - `gzip: false`: aggiunto per evitare errori di decompressione
   - Il `corePath` deve essere `file://` URL perché Tesseract.js lo usa con fetch
   - Il `workerPath` deve essere filesystem path perché Node `new Worker(path)` lo richiede
3. **Commit 3**: Bump versione 1.3.1 → 1.3.2, aggiorna CHANGELOG

## File modificati
- `src/main/parsers/ocrParser.ts` — sostituito pdfjs+node-canvas con MuPDF, aggiunta `resolveTesseractPaths()`
- `electron-builder.config.js` — già corretto, nessuna modifica necessaria
- `package.json` — version bump 1.3.1 → 1.3.2
- `CHANGELOG.md` — aggiunta sezione [1.3.2]

## Commit creati
- `54b29f8` fix(ocr): switch PDF rendering from pdfjs/node-canvas to mupdf
- `ed4b6b8` fix(ocr): resolve tesseract.js paths correctly for Electron packaged app
- `2794e63` chore: bump version 1.3.1 → 1.3.2; update CHANGELOG

## Stato finale
- `npm run typecheck`: zero errori ✓
- `npm test`: 157/157 test passati ✓

## Problemi noti / TODO prossima sessione
- In sviluppo, `_require.resolve()` funziona correttamente.
- In packaged, i path vengono costruiti esplicitamente da `process.resourcesPath/app.asar.unpacked`.
  Testare su una build reale (DMG) prima del prossimo rilascio per confermare che OCR funzioni.
- `electron-builder.config.js` aveva già `asarUnpack` corretto per tesseract — nessuna modifica necessaria.
