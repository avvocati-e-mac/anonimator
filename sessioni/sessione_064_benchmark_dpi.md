# Sessione 064 — Benchmark sintetico della strategia DPI
**Data:** 2026-09-11
**Versione:** 1.8.0 (sviluppo post-release, nessun bump)

## Obiettivo

Costruire una misura riproducibile dei candidati OCR 200, 300 e 400 DPI prima di
modificare la strategia produttiva. Il benchmark deve attraversare la pipeline
OCR e PDF reale, ma usare esclusivamente contenuto artificiale e file temporanei.

## Orchestrazione

- L'audit ha ricostruito il call graph dal parametro IPC fino a
  `parsePdfWithOcr()`, al preflight 50 MP, all'artefatto OCR Main-only e a
  `generatePdfSafe()`.
- Il lavoro è stato isolato in un harness manuale, fuori da `test:unit`, perché
  ogni run crea realmente un worker Tesseract e misura memoria e tempi.
- Il parent avvia un processo fresco per ogni combinazione fixture/DPI, ruota
  l'ordine dei DPI fra le repliche, applica un timeout di 240 secondi e accetta
  dal child soltanto uno schema numerico chiuso.

## Implementazione

- `tests/helpers/dpiBenchmarkMetrics.ts` implementa normalizzazione, recall delle
  sequenze sensibili, token recall tramite LCS, WER, CER e metriche geometriche.
  CER confronta i caratteri dopo NFKC, case-fold e rimozione degli spazi.
- `tests/dpiBenchmarkRunner.test.ts`, attivato solo dal runner, genera in `tmp`
  una scansione senza layer testuale, chiama `parsePdfWithOcr()`, legge
  l'artefatto tramite la cache Main-only, converte i bbox OCR nello spazio MuPDF
  e invoca `generatePdfSafe()` con il ledger sintetico.
- `scripts/benchmark-dpi.mjs` esegue la matrice, verifica nuovamente schema,
  source DPI, OCR DPI, cardinalità delle repliche e risultato dei gate, quindi
  stampa soltanto metriche aggregate. Errori e timeout espongono esclusivamente
  codici fissi `DPI_BENCH_*`, mai output del child, contenuto o percorsi.
- Il sampler di memoria viene sempre arrestato. Handle pending e token attivi
  vengono rispettivamente scartati e rilasciati; lo stato della cache dopo il
  run deve coincidere con il baseline.
- Aggiunto `npm run bench:dpi`; il default è tre repliche e
  `--repetitions=1` esegue uno smoke completo.

## Matrice sintetica

| Fixture | DPI sorgente | Caratteristica |
|---------|-------------:|----------------|
| `clean` | 300 | Testo regolare e JPEG ad alta qualità |
| `small-7pt` | 300 | Target sensibili a 7 punti |
| `degraded-150dpi` | 150 | JPEG qualità 48 e rumore pseudocasuale seeded |

Ogni fixture viene riconosciuta a 200, 300 e 400 `ocrDpi`. I 150 DPI descrivono
soltanto il raster sorgente: non vengono passati come candidato a produzione e
non aggirano `resolveOcrDpi()`.

## Metriche e gate

Il report aggrega recall exact-match delle sequenze sensibili, token recall,
WER/CER, copertura e IoU dei bbox, errore massimo del centro e dei bordi, tempo,
RSS/heap e dimensione del PDF finale.

Per ogni singolo run sono inderogabili:

- recall sensibile pari a 1;
- output `complete`;
- `matchedTargets === targetCount`;
- errore del centro non superiore a 4 punti.

Le soglie testuali aggiuntive sono token recall/CER `0,98/0,02` per `clean`,
`0,90/0,08` per `small-7pt` e `0,85/0,12` per `degraded-150dpi`. Un candidato è
verde soltanto se supera tutte le fixture e tutte le repliche; le medie non
possono nascondere un falso negativo. Il baseline 300 non verde produce exit
code non zero.

La dimensione dell'output è dichiarata
`source-native-independent-of-ocr-dpi`: `generatePdfSafe()` renderizza la pagina
alla risoluzione nativa stimata, mentre il DPI candidato riguarda il solo OCR.

## Risultato smoke

Comando: `npm run bench:dpi -- --repetitions=1`.

- 9 run reali completati in circa 17 secondi.
- Tutti i candidati hanno ottenuto recall sensibile e token recall pari a 1,
  WER/CER pari a 0, tre target su tre, output completo ed errore del centro sotto
  0,97 pt.
- Il tempo OCR è cresciuto, a seconda della fixture, da circa 0,77–0,85 secondi
  a 200 DPI a circa 1,25–1,39 secondi a 400 DPI.
- Il delta RSS è cresciuto da circa 221–223 MiB a 200 DPI a circa 300–305 MiB a
  400 DPI.
- La dimensione finale è rimasta sostanzialmente stabile fra i tre OCR DPI
  all'interno della stessa fixture, confermando il disaccoppiamento atteso.

Lo smoke con una sola replica valida l'harness ma non costituisce evidenza
sufficiente per cambiare la policy produttiva.

## Decisione

Il default resta 300 DPI. Prima di valutare 200 servono le tre repliche standard,
fixture ulteriormente discriminanti e un vantaggio stabile di tempo/memoria
senza alcuna regressione di recall o geometria. I 400 DPI restano una possibile
escalation mirata soltanto per falsi negativi riproducibili su fixture sintetiche,
non un default e non un retry dopo fallimenti.

## Invarianti

- Trust boundary invariato: artefatto e token OCR restano Main-only.
- Pipeline PDF fail-closed invariata; nessun downgrade automatico del DPI dopo
  errore OCR, rendering o superamento dei 50 MP.
- Nessun dato personale acquisito, registrato o versionato.
- Fixture, PDF e risultati individuali creati esclusivamente in directory
  temporanee e rimossi al termine.
- Nessuna modifica alla configurazione produttiva, nessun bump versione, tag,
  push o release.

## Verifiche

- `npm run typecheck:all`: verde.
- `tests/dpiBenchmarkMetrics.test.ts`: 6 test verdi.
- `npm run test:unit`: 596 test verdi, runner benchmark intenzionalmente skipped.
- Smoke completo 200/300/400 sulle tre fixture: verde.
- `git diff --check`: verde.
