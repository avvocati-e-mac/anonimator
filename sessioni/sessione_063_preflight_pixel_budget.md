# Sessione 063 — Preflight pixel budget e OCR fail-closed
**Data:** 2026-09-11
**Versione:** 1.8.0 (sviluppo post-release, nessun bump)

## Obiettivo

Chiudere il rischio di allocazioni raster eccessive prima di MuPDF/Tesseract e
rimuovere il fallback OCR che poteva trasformare un errore in testo digitale
vuoto o incompleto.

## Orchestrazione e audit

- Tre subagenti hanno verificato in parallelo i siti di rasterizzazione, la
  matematica del bounding box MuPDF, la strategia di test e il trust boundary.
- Sono stati individuati tre `toPixmap()` runtime: analisi layer a 72 DPI, OCR e
  generazione/validazione PDF raster.
- Il limite esistente di 50 MP veniva controllato soltanto dopo l'allocazione.
- `parsePdfWithOcr()` intercettava qualunque errore e ripiegava sul testo
  digitale, anche per pagine scan-no-text.

## Implementazione

- Aggiunto `services/renderBudget.ts`: proietta i quattro angoli con la matrice
  effettiva, replica la semantica float32 e `fz_round_rect` di MuPDF, valida gli
  interi e applica il limite con divisione overflow-safe.
- Tutti i raster MuPDF passano dal preflight prima di `toPixmap()`; il controllo
  post-render nel generatore resta attivo come difesa in profondità.
- `parseImage()` legge i metadati dimensionali con Sharp e rifiuta oltre 50 MP
  prima di caricare Tesseract.
- Errori di worker, rendering, PNG o riconoscimento OCR interrompono l'analisi.
  Il documento, la pagina, il worker e i PNG temporanei vengono chiusi anche in
  errore; nessun artefatto OCR parziale viene pubblicato.
- Aggiunti soltanto codici errore fissi all'allowlist del logger; nessun contenuto
  o identificatore documentale viene registrato.

## Test sintetici

- Matematica del preflight: A4, soglia esatta, overflow, skew, rotazione,
  traslazione, coordinate negative e input invalidi.
- Callback di rendering non invocato oltre budget.
- Immagine oltre 50 MP rifiutata prima della creazione del worker.
- PDF oltre budget verificato sostituendo `toPixmap`, senza allocazioni reali.
- Errore di riconoscimento verificato fail-closed: worker terminato, nessun
  fallback digitale e cache OCR vuota.

## Invarianti

- Trust boundary Main-only invariato.
- Pipeline PDF fail-closed rafforzata; nessun downgrade o output parziale.
- Fixture esclusivamente sintetiche e temporanee.
- Nessun dato personale acquisito, loggato o versionato.
- Nessun tag, push o rilascio.

## Verifica live prima del commit

- Fetch remoto e tag completato senza variazioni inattese.
- `origin/master` è `ee33143`; il ramo di lavoro contiene tale baseline e i
  commit locali post-release già documentati.
- Il tag annotato `v1.8.0` punta al commit di release `7339877`.
- Release GitHub stabile, non draft e non prerelease, con quattro artefatti
  caricati: DMG arm64, DMG x64, AppImage Linux x86_64 e setup Windows x64.
- Gli ultimi workflow `Release` su tag e `master` risultano conclusi con successo.

## Verifiche

- `git diff --check`: verde.
- `npm run typecheck:all`: verde.
- Test mirati: 4 file, 43 test verdi.
- `npm run test:unit`: 42 file, 590 test verdi.
- `npm run ui:build`: verde.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:roundtrip`: 60 fixture, nessuna anomalia.
- `npm run test:pixel-leak`: 3 test verdi.
- `npm run test:searchable-pdf`: 3 test verdi.
- `npm run test:pdf-rss`: verde, plateau 131,1 MiB.

## Prossima unità proposta

Benchmarkare la strategia DPI su fixture sintetiche riproducibili e definire
quando usare 200/300/400 DPI senza abbassamenti automatici che possano introdurre
falsi negativi. L'output bitonale resta una fase separata e misurabile.
