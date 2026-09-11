# Sessione 060 — Cleanup overlay legacy
**Data:** 2026-09-11
**Versione:** 1.8.0 (sviluppo post-release, nessun bump)

## Obiettivo

Rimuovere l'implementazione PDF pre-v1.6 non più raggiungibile e i relativi test-hook,
conservando invariati trust boundary, routing Main-only e pipeline PDF fail-closed.

## Decisioni prese

- Il lavoro è stato svolto su `refactor/pdf-overlay-cleanup`, creata da `master`
  dopo il commit documentale dell'audit post-v1.8.0.
- Tre subagenti hanno verificato in parallelo call graph, dipendenze dei test e
  invarianti di sicurezza. Nessun subagente ha modificato file sensibili.
- `pdfGenerator.ts` è ora un façade minimale che delega esclusivamente a
  `pdfSafeGenerator.ts`.
- Il routing `digital`/`flattened-scan` è diventato obbligatorio nel façade: non
  esiste più un default implicito verso il percorso digitale. La produzione già
  ricava sempre il routing nel Main e il ramo d'errore forza `flattened-scan`.
- Rimossi circa 1.000 righi di implementazione legacy, inclusi fallback overlay,
  seconda passata OCR disabilitata, validatore duplicato, matcher e guardie non usate.
- Eliminati i test unitari degli helper morti e sostituiti con caratterizzazioni
  degli entry point pubblici e del ledger della pipeline attiva.
- Una scansione non attendibile o un'immagine senza artefatto OCR token-bound
  continua a fallire con `ocr-artifact-missing`, senza output o temporanei residui.
- La guardia attiva sui rettangoli oltre il 25% è ora verificata tramite il risultato
  pubblico: ledger `rejected`, stato `partial` e suffisso `_DA_VERIFICARE`.
- Nessuna modifica a IPC, registry, fingerprint, ledger, cache OCR o searchable layer.
- Nessun tag è stato creato e nessuna release è stata pubblicata.

## File modificati

- `src/main/outputGenerators/pdfGenerator.ts`
- `src/main/services/ocrRenderConfig.ts`
- `src/main/parsers/ocrParser.ts`
- `tests/pdfGenerator.test.ts`
- `tests/pdfSafeGenerator.test.ts`
- `tests/pixelLeak.test.ts`
- `GUIDA.md`
- `sessioni/sessione_060_cleanup_overlay_legacy.md`

## Verifiche

- `git diff --check`: verde.
- `npm run typecheck:all`: verde.
- `npm run ui:build`: verde.
- `npm run test:unit`: 38 file, 563 test verdi.
- `npm run test:ner-recall`: 4 test verdi; 26 TP, 0 FP, 0 FN.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:roundtrip`: 60 PDF, 365 parole OCR reali, nessuna anomalia.
- `npm run test:pixel-leak`: 2 test verdi.
- `npm run test:searchable-pdf`: 3 test verdi.
- `npm run test:pdf-rss`: RSS 131,8–131,9 MiB, stabile.

## Problemi noti / TODO prossima sessione

1. Prossima fase del piano: benchmark sintetico delle strategie DPI, senza cambiare
   il default 300 prima di evidenze riproducibili su OCR, geometria, tempo, output e RSS.
2. Un audit parallelo ha rilevato che `ipcHandlers.ts` registra alcuni `outputPath`
   completi. Il path può contenere dati identificativi e va corretto in una unità
   separata con test sui log, usando soltanto metadati sanitizzati.
3. Output bitonale e firma/notarizzazione restano fasi distinte e successive.
4. Restano non bloccanti il warning Node 20/24 di gitleaks e gli avvisi di dipendenze CI.
