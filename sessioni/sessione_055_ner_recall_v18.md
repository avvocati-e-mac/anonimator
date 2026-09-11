# Sessione 055 — Recall NER/OCR v1.8
**Data:** 2026-09-11
**Versione:** 1.7.0-beta.1 (sviluppo v1.8, nessun bump)

## Obiettivo

Avviare la fase v1.8 dedicata al recall delle entità, verificare prima il pacchetto macOS arm64 pubblicato per il P0 #21 e introdurre un corpus sintetico con metriche riproducibili senza dati personali.

## Decisioni prese

- Creata `feat/ner-recall-v18` dalla tip aggiornata `505a49a` di `feat/ocr-cache-layer-v17` dopo fetch live. Il tag annotato `v1.7.0-beta.1` è invariato e dereferenzia `b3e7efb`; i soli commit successivi sulla base sono i due handoff documentali `be195ee` e `505a49a`.
- Verificata live la release prerelease e il workflow `34603045613`, concluso con successo sul commit del tag.
- Smoke P0 eseguito sul DMG arm64 pubblicato: 261055582 byte, SHA-256 `20e5dd09ecb19dfb8cae8e5197e3f0e31679001ad96b89a1d70cf2a18b3908fc`, `hdiutil verify` valido, versione `1.7.0-beta.1`, eseguibile arm64 e avvio con profilo `userData` isolato.
- La fixture geometrica `neg-03-allineato-jpeg.pdf` non è adatta a uno smoke OCR perché il raster contiene intenzionalmente barre e non glifi. È stata quindi generata soltanto sotto `/private/tmp`, senza versionarla, una scansione sintetica A4 di 23 pagine, JPEG 1653×2339 a 200 DPI.
- Lo smoke leggibile ha prodotto un output `complete` di 23 pagine: input 3819229 byte, output 3496184 byte, rapporto 0,915. Le immagini finali sono JPEG 1654×2339 a 200 DPI (arrotondamento A4 di un pixel), `qpdf --check` è verde, il testo originale è assente sia dal layer sia dal raster OCR e 92 pseudonimi sono presenti nel layer ricercabile.
- Issue GitHub #21 chiusa con queste evidenze e con la dichiarazione esplicita che il documento reale originario non era disponibile nel repository.
- Creato un corpus di 21 casi interamente sintetici: 16 positivi e 5 negative controls, con confronto exact-match occurrence-aware e metriche aggregate per tipo, micro e macro. Il report contiene solo conteggi e label di tipo.
- Baseline pre-fix: TP 12, FP 6, FN 14; precision 0,6667, recall 0,4615, F1 0,5455. Dopo i fix: TP 26, FP 0, FN 0; precision/recall/F1 micro e macro pari a 1,0.
- I nuovi pattern OCR tolleranti sono ammessi soltanto dietro etichette forti. P.IVA e targa richiedono contesto per eliminare sequenze ambigue. Il datore di lavoro rilevato come organizzazione resta deselezionato di default.
- La cache dei candidati BERT sotto soglia non è stata modificata: il boost exact-text attuale non produce un effetto osservabile end-to-end e non sono stati aggiunti hook riservati ai test.
- Una regressione riproducibile nel ledger convertiva `expectedOccurrences: null` delle entità manuali/importate in `1`. La correzione distingue ora `null` esplicito da `undefined`; zero occorrenze resta `partial`, una o due occorrenze completamente redatte risultano `complete`.
- Trust boundary, routing fail-closed, cache OCR e costruzione raster/searchable layer sono rimasti invariati, salvo la correzione puntuale della semantica del ledger sopra descritta.

## File modificati

- `src/main/services/regexPatterns.ts`
- `src/main/services/nerService.ts`
- `src/main/outputGenerators/pdfSafeGenerator.ts`
- `tests/fixtures/nerRecallCorpus.ts`
- `tests/nerRecallEvaluation.test.ts`
- `tests/nerIntegration.test.ts`
- `tests/nerRegex.test.ts`
- `tests/analysisRegistry.test.ts`
- `tests/pdfSafeGenerator.test.ts`
- `package.json`
- `.github/workflows/release.yml`
- `CHANGELOG.md`
- `CLAUDE.md`
- `GUIDA.md`

## Verifiche

- `npm run typecheck:all`: verde.
- `npm run ui:build`: verde.
- `npm run test:unit`: 37 file, 586 test verdi.
- `npm run test:ner-recall`: 4 test verdi; TP 26, FP 0, FN 0.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:roundtrip`: 60 PDF, 365 parole OCR reali, nessuna anomalia.
- `npm run test:pixel-leak`: 2 test verdi.
- `npm run test:searchable-pdf`: 3 test verdi.
- `npm run test:pdf-rss`: RSS 130,3–130,5 MiB, stabile.
- Test mirati manual/import/batch/ledger: verdi; aggiunta copertura per ID manuale/importato ignoto e cardinalità zero/una/due.

## Problemi noti / TODO prossima sessione

- Il corpus è sintetico e deterministico: il risultato perfetto non sostituisce una futura validazione su un campione reale autorizzato e anonimizzato fuori dal repository.
- Il boost BERT sotto soglia e la relativa cache vanno ridisegnati soltanto se viene definito un comportamento end-to-end misurabile.
- Restano fuori fase output bitonale, nuove strategie DPI, cleanup overlay legacy, firma/notarizzazione, promozione stabile e pubblicazione di nuove release.
- `PROJECT_MASTER v2.1.md`, citato da `CLAUDE.md`, non è presente nel repository con quel nome.
