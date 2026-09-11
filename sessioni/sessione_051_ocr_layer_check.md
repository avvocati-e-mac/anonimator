# Sessione 051 — Qualità e allineamento del layer OCR nei PDF scansionati
**Data:** 2026-09-11
**Versione:** 1.5.0 → 1.6.0
**Branch:** `feat/ocr-layer-quality-check`

## Obiettivo

Rilevare automaticamente, senza intervento dell'utente, se un PDF è una **scansione con layer di testo OCR** e se quel layer è **allineato ai pixel** dell'immagine. In caso contrario avvisare e offrire un nuovo OCR interno. Contestualmente: misurare la qualità del raster sorgente e correggere il percorso di output, che oggi non rimuove davvero i pixel.

Il piano completo, con algoritmo, corpus e red teaming, è in
`~/.claude/plans/esamina-il-repository-vorrei-partitioned-honey.md`.

## Il problema di partenza

Il routing PDF dipende da una riga (`pdfParser.ts:225`): `isScanned = caratteri/pagine < 80`.
Ne conseguono due percorsi, e **manca la terza categoria**: la scansione **con** layer OCR
(scanner, ABBYY, Adobe, allegati PEC) ha ~2000 caratteri/pagina e ricade quindi nel percorso
"nativo". Lì `pdfGenerator.ts:72` chiama `applyRedactions(false, 0)` — e quello `0` è
`REDACT_IMAGE_NONE`: **le immagini non vengono toccate**. Sopra viene solo disegnato un
rettangolo pdf-lib.

- Layer allineato → il nome è coperto alla vista, ma i pixel restano nel file (`pdfimages` li recupera).
- Layer disallineato → il rettangolo finisce nel punto sbagliato e **il nome resta leggibile**,
  mentre l'app riporta "N entità sostituite".

## Decisioni prese

| Tema | Decisione |
|---|---|
| Ambito | Discovery + correzione dell'output per i PDF-immagine. `REDACT_IMAGE_PIXELS` sul percorso **nativo** resta fuori scope |
| Interfaccia | Banner non bloccante in `EntityReview`. Nessuna schermata nuova, nessuna opzione nelle Impostazioni |
| Batch | Fuori scope, salvo ~5 righe in `generateOutput` perché la correzione privacy non resti scoperta |
| Corpus | Generato da noi, versionato in `tests/corpus-ocr/`, solo dati manifestamente finti |
| Qualità immagine | Avvisare sì; migliorie solo a costo zero di dipendenze nuove |
| `mupdf` | **Pin esatto 1.27.0**: la 1.28 rende obbligatori gli argomenti di `search()` e `toStructuredText()` |

## File modificati

### Onda 0
- `src/shared/types.ts` — contratto completo: `PdfLayerKind`, `OcrLayerVerdict`,
  `TextQualityVerdict`, `ImageQualityVerdict`, `ImageQualityMetrics`, `OcrPageMetrics`,
  `OcrLayerReport`, `ProcessDocumentOptions`, più i codici di motivazione come **enum chiusi**
  (`OcrPageReason`, `TextQualityReason`, `ImageQualityReason`) — così la regola privacy
  "nessun contenuto documentale nel report" è verificata dal compilatore, non dalla disciplina.
  Estesi `DocumentAnalysisResult` (`ocrReport?`) e `AnonymizeRequest` (`layerKind?`, `ocrAligned?`).
- `package.json` — versione 1.6.0, `mupdf` pinnato a 1.27.0 esatto
- `package-lock.json` — allineato (correggeva anche un `version: 1.4.0` rimasto indietro)
- `CHANGELOG.md` — stub `## [1.6.0] - non rilasciata`, per non lasciare il repo con una
  versione senza voce se ci si ferma a metà (CLAUDE.md §5b)

## Problemi ambientali incontrati (utili a chi riprende)

1. **`npm ci` non esegue gli install-script delle dipendenze** (npm 11.19 richiede
   `allowScripts`). Il `postinstall` del progetto — `patch-package` — gira comunque, quindi
   la patch a `tesseract.js` è applicata. Restano da eseguire a mano quelli delle dipendenze:
   `electron`, `esbuild`, `onnxruntime-node`, `sharp`, `protobufjs`
   (`electron-winstaller` serve solo per la build Windows).
2. **L'estrazione dello zip di Electron fallisce in silenzio** dentro iCloud Drive:
   `install.js` esce con 0 ma produce un `dist/` da 244K invece di 281M, e non scrive
   `path.txt`. Coerente con gli altri problemi iCloud già documentati in `CLAUDE.md`.
   Rimedio applicato:
   ```bash
   rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
   unzip -qq -o ~/Library/Caches/electron/<hash>/electron-v40.8.0-darwin-arm64.zip \
     -d node_modules/electron/dist
   echo "Electron.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
   ```
   Senza questo, 4 file di test falliscono con "Electron failed to install correctly".

## HANDOFF — stato al 2026-09-11

- **Blocco corrente:** 1 · **Ultima onda completata:** Onda 0 · **Ultimo gate superato:** nessuno
- **Ultimo commit buono:** _(da assegnare al commit di Onda 0)_
- **typecheck:** OK · **test:** 291/291
- **Fatto:** ambiente installato e riparato, branch creato, contratto dei tipi completo,
  versione e lock allineati, stub CHANGELOG, questo file
- **Prossimo passo:** Onda 1 — tre esecutori in parallelo:
  - **E1** `src/main/services/ocrLayerCheck.ts` + test (spike MuPDF obbligatorio per primo)
  - **E2** `src/main/services/textQuality.ts` + test
  - **E3** `tests/corpus-ocr/**` (prima i `negativi/`, poi i `geometrici/` a difficoltà bassa)
- **Decisioni aperte:** nessuna
- **Trappole note da rispettare:**
  - `getPixels()` è una **vista viva** sulla heap WASM: si stacca in silenzio se cresce.
    Costruire prima la geometria del testo, rendere dopo, nessuna chiamata MuPDF in mezzo,
    guardia `px.length < stride * h`.
  - `showExtras` vale `true` di default: passare `false`, o le annotazioni entrano nella maschera.
  - Omettere `onChar` salta l'intero ciclo dei caratteri (~3000 `keep_font` per pagina risparmiati).
  - Una sola `toStructuredText()` per pagina: `asJSON()` è un metodo della stessa istanza.
  - `asJSON()` restituisce **il testo del documento**: mai nei log né nel report.
- **Per riprendere:**
  ```bash
  git checkout feat/ocr-layer-quality-check
  npm ci && npm run typecheck && npm test   # se i test Electron falliscono, vedi §Problemi ambientali
  ```
  poi rileggere il piano e questo file, e aprire l'Onda 1.
