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

## Onda 2 — stato e questioni aperte (commit `c112eef`)

E5, E6, E7 integrati e committati. E8 (`ocrParser.ts`) **ancora in corso** al momento
in cui questo paragrafo è stato scritto.

### Da collegare appena E8 rientra
- [ ] **`ocrDpi` non arriva a `parsePdfWithOcr`.** E5 ha lasciato il commento
      `// DPI gestito da E8` in `src/main/parsers/index.ts` senza forzare la firma di un
      file altrui — corretto come disciplina, ma il filo resta scoperto: oggi il pulsante
      "Rifai OCR" userebbe il DPI di default invece di `suggestedOcrDpi` del report.
      Il pulsante funzionerebbe **senza fare davvero quello che promette**.

### Questioni aperte lasciate da E6 (nessuna bloccante, tutte reali)
- [ ] **`ICCBased` escluso dalla redazione dei pixel.** È lo spazio colore più comune
      nelle scansioni a colori vere: escluderlo significa che molti documenti reali
      ricadono sull'overlay, cioè **i pixel restano nel file**. Il bug MuPDF 709269
      riguarda Indexed/Separation/DeviceN, non ICC che avvolge Gray/RGB/CMYK. Valutare
      di ammettere ICCBased con 1/3/4 componenti, verificando su scansioni a colori vere.
- [ ] **Guardie su `SMask`/`Mask` e `ImageMask` prudenziali.** E6 ha verificato che su
      MuPDF 1.27 le fixture `img-11-smask` e `img-12-indexed` **non** mostrano il difetto
      documentato. Le guardie quindi oggi costano privacy reale su file che
      probabilmente si potrebbero redigere. Da rivalutare, idealmente con MuPDF ≥ 1.28.1
      (che corregge 709269) — ma ricordare che la 1.28 rompe `search()` e
      `toStructuredText()`, vedi il pin in `package.json`.
- [ ] **`pixels-from-ocr` e `generatePdfFromImage` non testati**: manca
      `resources/tessdata/ita.traineddata` (c'è solo in userData). È il buco di copertura
      più grande dell'Onda 2.
- [ ] **Percorso `digital`: nessuno scrub dei metadati.** Una miniatura `/Thumb` su un
      PDF nativo può conservare la pagina pre-redazione. Fuori scope per scelta, ma va
      saputo.

### Da riesaminare (E7)
- [ ] Quando l'immagine è pessima **e** il layer è disallineato, il banner fa vincere
      "immagine pessima" e **nasconde** il pulsante. È difendibile — sotto i 150 DPI un
      nuovo OCR non recupera dettaglio che non c'è — e regge perché la geometria viene
      comunque corretta a valle: con un layer non certificato allineato, il generatore
      ricade sui box Tesseract, auto-consistenti per costruzione. Quindi il pulsante
      serve a migliorare il *rilevamento entità*, non a raddrizzare i riquadri.
      Verificare che questo ragionamento regga leggendo il codice di E6.

### Misure da ricordare
Rapporti di dimensione dopo la redazione reale (l'immagine viene ri-codificata **non
compressa**): G4 `img-14` **2,62×**; scansione JPEG `neg-03` **53×** (3,7 MB/pagina);
grigio 300 DPI **449×** (8,3 MB). Su 10 pagine JPEG si superano i 20 MB: la soglia di
avviso serve davvero, ed è il motivo per cui `SaveResult` è stato esteso e
`SuccessScreen` mostra l'avviso.

## Onda 2 — chiusura di E8 e giunzioni fra esecutori

### E8 — OCR interno (`ocrParser.ts`, commit `7a95282`)

`parsePdfWithOcr` e `parseImage` accettano ora `OcrParseOptions { dpi?, skewDeg?,
unevenLighting? }`, retrocompatibili. Il DPI è risolto **sempre** da
`ocrRenderConfig.ts`: nessuna costante locale, quindi il file non può divergere
in silenzio da `pdfGenerator.ts` (era R9 del piano, il punto di rottura più
insidioso dell'Onda 2 — ora chiuso da entrambi i lati).

- **`thresholding_method` esiste davvero.** Lo spike previsto dal piano ha dato
  esito positivo: verificato nelle stringhe del WASM di `tesseract.js-core@5.1.1`
  ("Thresholding method: 0 = Otsu, 1 = LeptonicaOtsu, 2 = Sauvola") e
  raggiungibile da `setParameters` (passthrough generico a `SetVariable`, non è
  fra i parametri solo-init). Il rimedio non decade.
- **`user_defined_dpi`** viene passato al worker: senza, Tesseract assume un
  default interno e può segnalare una risoluzione "non valida".
- **Deskew** implementato come funzione pura `buildOcrRenderMatrix(dpi, skewDeg?)`,
  che rifà a mano la matematica di `mupdf.Matrix.scale/rotate/concat` (verificata
  riga per riga sul sorgente). Il motivo è pratico: importare `mupdf` istanzia il
  runtime WASM al solo import, anche solo per usare `Matrix`, e questo avrebbe
  reso i test pesanti e fragili.
- **Un solo worker per documento**, non più uno per pagina (~14 MB di
  `ita.traineddata` ricaricati ogni volta). Se la creazione fallisce, tutte le
  pagine degradano al testo digitale invece di ritentare una creazione già
  fallita a ogni pagina.

### Prova dell'ipotesi dei 150 DPI — esito: **inconcludente**

Il piano imponeva di scrivere il risultato nel registro *in entrambi i casi*.
Misura su fixture sintetica di 8 pagine (sandwich scansione + testo, nessun
contenuto reale):

| Rendering | Tempo | Caratteri estratti |
|---|---|---|
| 150 DPI | 10 858 ms | 7 270 |
| 300 DPI | 13 917 ms | 7 270 |

300 DPI costa ~28% di tempo in più e non estrae un carattere in più. È un
**effetto soffitto**: la fixture è un sandwich sintetico pulito, non una
scansione degradata. La misura quindi **non conferma e non smentisce** il
collegamento con il divario di recall 80,0% → 62,9% di `sessione_049`, che
riguardava il NER su documenti reali e non il conteggio di caratteri su una
fixture. Per chiudere la pista serve una scansione reale di bassa qualità con
verità di riferimento: finché non c'è, 300 DPI resta la scelta giustificata
dalla documentazione Tesseract (x-height ~10 px a 150 DPI), non da una misura
fatta in casa.

### Giunzioni fra esecutori chiuse dall'orchestratore (commit `e3fd471`)

Tre fili che nessun esecutore poteva chiudere da solo, perché stavano fra i
rispettivi elenchi di file:

1. **`parsePdfWithOcr` veniva chiamato senza opzioni.** Il pulsante "Rifai OCR"
   avrebbe usato il DPI di default invece di `suggestedOcrDpi`, e
   `skewDeg`/`unevenLighting` non avevano alcun chiamante: due dei tre rimedi di
   E8 sarebbero rimasti codice morto. Ora `buildOcrParseOptions(report, dpi?)`
   traduce il report in opzioni, e il percorso `forceOcr` rianalizza l'immagine
   prima di ricominciare — ~150-300 ms dentro un'attesa di minuti.
2. **Dopo un OCR rifatto da noi il report restava quello del layer vecchio.**
   `reportAfterForcedOcr` lo declassa a `scan-no-text` / `inconclusive`: è la
   coppia che porta la redazione sui riquadri di Tesseract, auto-consistenti per
   costruzione. Dichiararlo `aligned` sarebbe stato peggio che inutile —
   instraderebbe l'output sul percorso veloce `page.search()` sopra un layer che
   non stiamo più leggendo. La qualità dell'**immagine** sopravvive (una
   scansione a 100 DPI lo resta anche dopo); la qualità del **testo** si
   ricalcola su ciò che abbiamo prodotto noi.
3. **Il banner riproponeva il rimedio appena eseguito.** Con `ocrRedone` i
   messaggi post-OCR diventano quelli onesti ("rifarlo darebbe lo stesso
   risultato, verificare a mano") e il pulsante sparisce.

**Limite noto:** `scoreTextQuality` si astiene sotto i 40 token
(`text-too-short` → verdetto `good`). È corretto per giudicare un layer
preesistente — un frontespizio non va accusato — ma significa che un nuovo OCR
che restituisce quasi nulla non viene marcato `poor` da questa via. È coperto
altrove (warning di bassa confidenza di Tesseract, elenco entità vuoto), ma va
saputo.

## HANDOFF — stato al 2026-09-11

- **Blocco corrente:** 2 · **Ultima onda completata:** Onda 2 (E5-E8 integrati) ·
  **Ultimo gate superato:** Gate A
- **Ultimo commit buono:** `e3fd471` — feat(ocr): collega il rendering dell'OCR forzato
- **typecheck:** OK · **test:** 525/525
- **Fatto:** contratto dei tipi, motore di rilevamento, qualità linguistica, corpus da
  56 fixture, taratura (Gate A), pipeline e IPC, redazione reale dei pixel con guardie,
  banner utente, OCR interno a 300 DPI con deskew e Sauvola, e le tre giunzioni fra
  esecutori. **La funzione è ora visibile all'utente e l'app è provabile con `npm start`.**
- **Prossimo passo: Gate B**, che è l'unica cosa che manca al Blocco 2:
  1. prova manuale con `npm start` sul corpus — `neg-*` nessun banner, `geo-*` banner
     con "Rifai OCR" funzionante, `img-03` avviso senza pulsante, PDF nativo invariato,
     DOCX intatto;
  2. **prova della fuga di pixel**, la più importante:
     `pdfimages -png documento_anonimizzato.pdf /tmp/estratte` deve mostrare **bianco**
     dove c'era il nome. Se non passa, E6 non è finito;
  3. verifiche accessorie su E6: oggetto originale rimosso, XObject condiviso, rapporto
     di dimensione, scrub di `/Thumb` e `/Metadata`, ricaduta su overlay per SMask e
     Indexed.
- **Poi Blocco 3 (Onda 3, E9):** `GUIDA.md`, `CLAUDE.md` (compresi gli errori
  preesistenti: `ProgressPayload`/`AnonymizeResult` non esistono, i nomi veri sono
  `ProcessingProgress`/`SaveResult`; `winston` è elencato ma il logger reale è
  `electron-log`), `CHANGELOG.md`, `README.md`. Poi merge su `master` e tag `v1.6.0`.
- **Decisioni aperte:** vedi "Onda 2 — stato e questioni aperte" (ICCBased escluso dalla
  redazione pixel, guardie SMask/ImageMask prudenziali, `pixels-from-ocr` e
  `generatePdfFromImage` non testati per mancanza di `resources/tessdata/ita.traineddata`,
  percorso `digital` senza scrub dei metadati).
- **Non fatto, dichiarato:** le fixture `roundtrip/` sono **vuote** — è il gruppo che
  spezza la circolarità del corpus (rendering → Tesseract vero → ricostruzione con
  offset noto). Finché mancano, il rilevatore è tarato solo su difetti che abbiamo
  costruito noi.
- **Trappole da rispettare (confermate sul campo):**
  - `getPixels()` è una vista viva sulla heap WASM: si stacca in silenzio.
  - `showExtras` vale `true` di default: passare `false`.
  - Omettere `onChar` salta l'intero ciclo dei caratteri.
  - Una sola `toStructuredText()` per pagina; `asJSON()` restituisce **il testo del
    documento**: mai nei log né nel report.
  - **R9 chiuso:** il DPI passa da `ocrRenderConfig.ts` sia in `ocrParser.ts` sia in
    `pdfGenerator.ts`. Non reintrodurre costanti locali: le redazioni finirebbero fuori
    posto **in silenzio**.
- **Per riprendere:**
  ```bash
  git checkout feat/ocr-layer-quality-check
  npm ci && npm run typecheck && npm test   # se i test Electron falliscono, vedi sopra
  ```
