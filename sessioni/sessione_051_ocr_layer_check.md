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

### Onda 1 — E1 (motore di rilevamento) — COMPLETATO
- `src/main/services/ocrLayerCheck.ts` (~1500 righe) — `analyzeOcrLayer()` più 20 funzioni pure.
- `tests/ocrLayerCheck.test.ts` (67 test su griglie sintetiche).

E1 ha trovato **tre difetti per misura**, non per ipotesi — vale la pena ricordarli
perché sono il tipo di errore che i test su dati finti non mostrano da soli:
- `crossCorrelate1D` su profili periodici dava punteggio 1.0 a lag 0/±40/±80 e
  l'argmax cadeva a caso: `scaleY = 1.0667` su profili **identici**.
- `LINE_GAP_RATIO 0.3` sbagliato di ~2,5×: a 72 DPI uno spazio di parola vale ~3,3px
  mentre 0,3× l'altezza riga dà 5px, quindi l'intera riga collassava in 1-3 run contro
  7-10 parole e `lineAgreement` valeva **0.00 su un sandwich perfettamente allineato**.
- Il bbox di riga va da ascendente a discendente mentre l'inchiostro sta fra maiuscole
  e linea di base: correlare un'onda quadra con una banda stretta dava falsi
  `scale-mismatch`. Introdotta `GLYPH_BAND` (0,25–0,85): coverage 0.877 → 0.990.

### Onda 1 — E3 (corpus) — INTERROTTO, completato dall'orchestratore
E3 è stato terminato da un limite di sessione dopo aver generato **56 fixture su 56**,
incluse quelle difficili (`geo-17-userunit`, `img-08-mrc`, `img-14-g4-grande`).
Mancavano il `README.md` e il gruppo `roundtrip/`. Il README è stato scritto
dall'orchestratore; `roundtrip/` resta **da fare** (vedi TODO).

## Gate A — esito

| Criterio | Soglia | Esito |
|---|---|---|
| Falsi positivi sui `negativi/` | 0, bloccante | **0** |
| Geometrici rilevati | ≥ 90% | **20/20** |
| `geo-05-una-riga` rilevato | obbligatorio | **sì** |
| Qualità immagine 300/150/100 DPI | good/marginal/poor | **corretta** |
| Tempo per pagina | < 60 ms | **~35 ms** |

Test: `tests/ocrCorpus.test.ts`, 56 casi, 2,2 s. Totale suite **437/437**, typecheck pulito.

### Guasti trovati dalla taratura (invisibili ai soli test sintetici)

1. **`lineAgreement` scorreva l'intera larghezza di pagina** invece della finestra x
   della riga. Due colonne → la banda y attraversa l'altra colonna; tabella → i filetti
   rendono l'inchiostro continuo. `neg-08` e `neg-10` risultavano `misaligned`: **due
   falsi positivi su documenti sani**, con il criterio a tolleranza zero.
   Accordo 0.00 → 1.00 (tabella) e 0.41 → 0.94 (due colonne).
2. **`fitScaleY` senza guardia sul braccio verticale.** Lo scarto di scala è
   `(lagBot − lagTop) / distanza`: un pixel di rumore vale `1/distanza`. Su una pagina
   di coda rada bastava per un falso `scale-mismatch` — e **quasi ogni documento reale
   ha un'ultima pagina rada**. Ora si astiene sotto `2 / SCALE_TOLERANCE` (~400px a
   72 DPI), soglia derivata dal rumore e non scelta a occhio.
3. **`aggregatePages` ignorava il motivo delle pagine inconcludenti**, quindi un
   documento con layer OCR solo sulla prima pagina risultava `aligned`. È il difetto
   documentato "OCR solo sulla prima pagina" degli MFP.
4. **`img-14` aveva `/BlackIs1` invertito**: la pagina renderizzava per l'89% nera e il
   motore si asteneva con `dark-page`. Conta molto, perché **il CCITT G4 è il formato
   dominante negli allegati PEC** e negli output MFP italiani.
5. **`geo-18` non era osservabile per costruzione**: tre pagine identiche, e spostare il
   layer di una pagina su pagine uguali non cambia nulla. Lezione generale: una fixture
   deve rendere il difetto *misurabile*, non solo presente.
6. **`verify.mjs` misurava la copertura sull'intero box di riga** invece che sulla fascia
   dei glifi: 36 segnalazioni su un corpus sano. Ora 7, tutte spiegabili.

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

## TODO prossima sessione

- [ ] **`roundtrip/` è vuoto.** È il gruppo che spezza la circolarità del corpus: tutte le
      altre fixture hanno difetti costruiti da noi, e tarare finché li si trova dimostra
      poco. Serve: raster a 200 DPI con JPEG e rumore → OCR con il nostro tesseract.js →
      ricostruzione con offset noto. `ita.traineddata` è presente in userData.
- [ ] **`BASELINE_MAX: 0.5` è probabilmente troppo stretta.** E1 ha misurato baseline ≈ 0.61
      su pagine di testo realistiche dopo la dilatazione: la guardia `ink-baseline-too-high`
      scatterebbe su pagine ordinarie. Sul corpus non è mai scattata, ma su scansioni vere
      più dense potrebbe. Suggerito 0.70–0.75, da verificare su documenti reali.
- [ ] **Nota per la taratura di `textQuality`:** le voci di un carattere nel set di parole
      funzionali (`a`, `e`, `i`, `o`, `l`, `d`) fanno risultare *alto* il tasso sul testo a
      lettere spaziate. Il caso resta `poor` per altri due segnali, e un test lo congela.
- [ ] **Debito tecnico:** `tsconfig.json` non typecheckka `tests/` (attività separata aperta).

## HANDOFF — stato al 2026-09-11

- **Blocco corrente:** 1 **COMPLETATO** · **Ultimo gate superato:** Gate A
- **Ultimo commit buono:** `1cf5b33` — feat(ocr): corpus di 56 PDF di riferimento e taratura
- **typecheck:** OK · **test:** 437/437 (291 preesistenti + 67 E1 + 23 E2 + 56 corpus)
- **Fatto:** ambiente riparato, contratto dei tipi, motore di rilevamento, qualità
  linguistica, corpus da 56 fixture con README, taratura completa, Gate A superato.
  **Nulla è ancora collegato alla pipeline: l'utente non vede alcun cambiamento.**
- **Prossimo passo:** Blocco 2 — Onda 2, quattro esecutori su file disgiunti:
  - **E5** pipeline e IPC (`parsers/index.ts`, `ipcHandlers.ts`, `preload`, `env.d.ts`)
        — include il fix dei disposer `removeAllListeners` e lo snapshot del sessionManager
  - **E6** percorso di output (`outputGenerators/`) — `REDACT_IMAGE_PIXELS` con le guardie
        su spazio colore, `/SMask`, area 25% e validazione dopo la scrittura
  - **E7** interfaccia (`OcrQualityBanner.tsx`, `EntityReview.tsx`, store)
  - **E8** qualità dell'OCR interno (`ocrParser.ts`) — 300 DPI, Sauvola, deskew al rendering
- **Decisioni aperte:** nessuna bloccante; vedi TODO.
- **Trappole da rispettare (confermate sul campo):**
  - `getPixels()` è una vista viva sulla heap WASM: si stacca in silenzio.
  - `showExtras` vale `true` di default: passare `false`.
  - Omettere `onChar` salta l'intero ciclo dei caratteri.
  - Una sola `toStructuredText()` per pagina; `asJSON()` è un metodo della stessa istanza
    e restituisce **il testo del documento**: mai nei log né nel report.
  - **R9 del piano:** `pdfGenerator.ts` L167-169 ricalcola `scale = 150/72` a mano,
    duplicando la costante di `ocrParser.ts`. Se E8 rende il DPI variabile e E6 non lo
    riceve, le redazioni finiscono fuori posto **in silenzio**. Il DPI va passato, mai
    ricalcolato, e va verificato con almeno due valori diversi.
- **Per riprendere:**
  ```bash
  git checkout feat/ocr-layer-quality-check
  npm ci && npm run typecheck && npm test   # se i test Electron falliscono, vedi sopra
  ```
