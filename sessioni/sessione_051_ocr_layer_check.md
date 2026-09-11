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

### Onda 1 — E2 (qualità linguistica) — COMPLETATO
- `src/main/services/textQuality.ts` (271 righe) — modulo puro, unico import è
  `import type` da `@shared/types`. `scoreTextQuality()`, `ITALIAN_FUNCTION_WORDS`
  (166 voci), `TEXT_QUALITY_TUNING` con tutte le soglie in un punto solo.
- `tests/textQuality.test.ts` (270 righe, 23 test) — soli dati sintetici.

Scelte degne di nota:
- **I token puramente numerici sono esclusi da tutte le metriche.** Un atto legale è
  pieno di date, importi e numeri di ruolo: includerli falserebbe lunghezza media e
  conteggio dei token singoli. Restano i misti tipo `art5`.
- **Forme elise nel set** (`dell`, `nell`, `all`…): il tokenizzatore spezza sull'apostrofo,
  e senza quelle voci il tasso sarebbe sottostimato proprio sui testi giuridici.
- **Nota per la taratura (E4):** le voci di un solo carattere (`a`, `e`, `i`, `o`, `l`, `d`)
  fanno sì che sul testo a lettere spaziate il `functionWordRatio` risulti *alto* (0,54)
  invece che crollato — le lettere isolate coincidono con le parole funzionali corte.
  Il caso resta `poor` grazie a due segnali indipendenti, e c'è un test di regressione
  che congela il comportamento. Se in taratura si tolgono le voci monocarattere, quel
  test lo segnala subito.
- «OCR in lingua sbagliata» esce `suspect`, non `poor`: l'inglese fallisce un solo
  segnale. Corretto così — il testo è leggibile, solo non italiano — e `suspect` basta
  comunque a far comparire il banner.

Verifica: typecheck pulito, 23/23 test del modulo, 314 test complessivi.
Audit indipendente dell'orchestratore: nessun `any`/`@ts-ignore`, nessun import di
`electron`, regex senza flag `g` nei `.test()` in ciclo (bug classico evitato),
divisione per zero protetta, file UTF-8 puri.

## Debito tecnico individuato (attività separata)

`tsconfig.json` ha `"include": ["src"]`: **`npm run typecheck` non controlla `tests/`**.
Vitest transpila senza type-checking, quindi oggi un `any` o un errore di tipo in un
test non lo rileva nessuno, nonostante `CLAUDE.md` §3 lo vieti ovunque. Misurato:
aggiungendo `tests` a `include` emergono solo **5 errori preesistenti** (3 import morti,
un accesso a `.text` su `DetectedEntity` che non esiste — bug latente vero — e un `.mock`
da sostituire con `vi.mocked`). Non corretto adesso per non cambiare il significato di
`npm run typecheck` mentre gli esecutori sono in corso. Aperta come attività a sé.

## Problemi ambientali incontrati (utili a chi riprende)

1. **`npm ci` non esegue gli install-script delle dipendenze** (npm 11.19 richiede
   `allowScripts`). Il `postinstall` del progetto — `patch-package` — gira comunque, quindi
   la patch a `tesseract.js` è applicata. Degli 8 script bloccati, **solo `electron` conta
   davvero**: verificato che `sharp` (libvips 8.17.3), `esbuild` (0.25.12) e `onnxruntime-node`
   funzionano comunque, perché i loro binari arrivano da pacchetti per piattaforma già
   installati. `electron-winstaller` serve solo alla build Windows.
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
- **Ultimo commit buono:** `91c203a` — chore(ocr): contratto dei tipi per l'analisi del layer OCR (v1.6.0)
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
