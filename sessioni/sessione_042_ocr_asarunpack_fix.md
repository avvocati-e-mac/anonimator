# Sessione 042 — Fix asarUnpack dipendenze Tesseract.js in Electron packaged
**Data:** 2026-03-16
**Versione:** 1.3.2 (nessun bump — solo fix build config)

## Obiettivo
Risolvere errori "Cannot find module" che impedivano l'avvio dell'OCR nell'app
packaged (DMG arm64). L'errore si manifestava al momento del caricamento del
worker-script di Tesseract.js (`app.asar.unpacked/node_modules/tesseract.js/
src/worker-script/node/index.js`).

## Contesto (dalla sessione 041)
La sessione 041 aveva già:
- Sostituito pdfjs+node-canvas con MuPDF per il rendering PDF in OCR
- Risolto i path di `workerPath` con distinzione `app.isPackaged`
- Caricato `ita.traineddata` in memoria via `readFile()` bypassando node-fetch/langPath
- Implementato `generatePdfScanned()` per anonimizzare PDF scansionati tramite
  bounding box OCR word-level

## Problema riscontrato in test sul Mac ARM64
Test della build `Anonimator-1.3.2-arm64.dmg` su altro Mac ha prodotto due
errori in sequenza al caricamento del worker OCR:

**Errore 1:**
```
Uncaught Exception: Error: Cannot find module 'node-fetch'
Require stack: .../app.asar.unpacked/node_modules/tesseract.js/src/worker-script/node/index.js
```

**Errore 2 (dopo fix parziale):**
```
Uncaught Exception: Error: Cannot find module 'regenerator-runtime/runtime'
Require stack: .../app.asar.unpacked/node_modules/tesseract.js/src/worker-script/node/index.js
```

## Diagnosi
Il worker-script `tesseract.js/src/worker-script/node/index.js` esegue
`require()` di moduli esterni al **top-level** (riga 1: `const fetch = require('node-fetch')`,
riga 10: `require('regenerator-runtime/runtime')`), prima di qualsiasi logica
applicativa. Questi moduli erano dentro `app.asar` mentre il worker-script era
in `app.asar.unpacked` — il `require()` da unpacked non trova moduli inside asar.

Tutti i moduli richiesti dal worker-script:
- `node-fetch` (+ `whatwg-url`, `tr46`, `webidl-conversions` — deps transitive)
- `regenerator-runtime`
- `bmp-js`, `idb-keyval`, `is-electron`, `is-url`, `wasm-feature-detect`, `zlibjs`

## Soluzione
Aggiunto tutte le dipendenze dirette di `tesseract.js` all'`asarUnpack` in
`electron-builder.config.js`, risolvendo il problema alla radice senza iterare
modulo per modulo.

## File modificati
- `electron-builder.config.js` — aggiunto a `asarUnpack`:
  `node-fetch`, `whatwg-url`, `tr46`, `webidl-conversions`,
  `bmp-js`, `idb-keyval`, `is-electron`, `is-url`,
  `regenerator-runtime`, `wasm-feature-detect`, `zlibjs`

## Commit creati
- `397023c` fix(build): add all tesseract.js deps to asarUnpack to fix packaged OCR

## Build prodotte
- `dist/Anonimator-1.3.2-arm64.dmg` — build locale arm64, da testare su Mac ARM

## Stato finale
- `npm run typecheck`: zero errori ✓
- `npm test`: 157/157 passati ✓
- Build arm64 completata ✓

## Problemi noti / TODO prossima sessione
- Testare il nuovo DMG arm64 sul Mac di test: verificare che l'OCR su PDF
  scansionato parta senza errori "Cannot find module"
- Se il test è OK: merge della branch `fix/ocr-tesseract-electron-paths` su
  `master` e rilascio tag v1.3.2
- Verificare lo stesso fix per la build Windows (stessa problematica asarUnpack
  si potrebbe presentare anche lì)
