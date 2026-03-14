# Sessione 004 — Fase 4: PDF Native + OCR
**Data:** 2026-03-05
**Stato:** COMPLETATA

## File creati
- `src/main/parsers/pdfParser.ts` — estrazione testo da PDF nativo con pdfjs-dist legacy
- `src/main/parsers/ocrParser.ts` — OCR immagini (tesseract.js) + PDF scansionati
- `src/main/parsers/index.ts` — aggiornato: PDF con auto-switch a OCR se scansionato
- `tests/pdfParser.test.ts` — 3 test PDF nativi (OCR non testabile senza tessdata)
- `tests/fixtures/sample.pdf` — PDF di test generato con pdf-lib

## Scoperte tecniche

### pdfjs-dist in Node.js
- Usare sempre `pdfjs-dist/legacy/build/pdf.mjs` (non il bundle browser)
- `GlobalWorkerOptions.workerSrc = ''` NON funziona in Node.js (errore "No workerSrc specified")
- Soluzione: puntare al worker bundled: `pdfjs-dist/legacy/build/pdf.worker.min.mjs`
- Usare `import.meta.url` per risolvere il path relativo correttamente

### TextItem vs TextMarkedContent
- `content.items` è `Array<TextItem | TextMarkedContent>`
- Discriminante: `'str' in item` → TextItem ha `str` e `hasEOL`, TextMarkedContent no
- Usare sempre il type guard prima di accedere a `item.str`

### OCR con tesseract.js
- tesseract.js v5 carica da `langPath` (directory) + `ita.traineddata` (o `.gz`)
- I test OCR NON sono possibili senza `resources/tessdata/ita.traineddata` (≈ 4 MB)
  → tessdata da scaricare in Fase 6 (packaging) o manualmente per test locali
- Per PDF scansionati: pdfjs renderizza la pagina su canvas (node-canvas) → png → tesseract
  Se node-canvas non è disponibile → fallback a estrazione testo digitale (per PDF ibridi)

### Auto-detect PDF scansionati
- Soglia: < 80 caratteri/pagina in media → `isScanned = true`
- Se scansionato: `parsePdf` restituisce `isScanned=true` e `index.ts` richiama `parsePdfWithOcr`

## Test totali: 38/38 passati
- 10 regex NER
- 7 sessionManager
- 18 parser (TXT/DOCX/ODT)
- 3 pdfParser (nativi)
- OCR: non testabile automaticamente (richiede tessdata), testato manualmente

## Post-processing: normalizeSpacedLetters (aggiunto post-test)

Test sui PDF reali ha rivelato che il PDF `_20230811_snciv@sL0@a2023@n24532@tO.pdf` (Sezione Lavoro)
produce testo con lettere separate da spazio: "L A C O R T E S U P R E M A".
Aggiunta funzione `normalizeSpacedLetters` in `pdfParser.ts` che comprime sequenze di 3+
lettere singole separate da spazio in una parola unica.
Regex: `/(?<![A-Za-zÀ-ÿ])([A-Za-zÀ-ÿ](?: [A-Za-zÀ-ÿ]){2,})(?![A-Za-zÀ-ÿ])/g`
I nomi propri (ROSSANA MANCINO, DANIELA CALAFIORE) vengono estratti correttamente — non intaccati.
Piccolo residuo "CASSAZION E" dove pdfjs spezza un token internamente — non correggibile senza
analizzare la geometria item per item; non impatta il NER semantico.

## Prossimo: Fase 5
- UI React completa: DropZone, ProcessingScreen, EntityReview, SuccessScreen
- Zustand store per gestione stato
- Connessione IPC completa per il flusso end-to-end
- Drag & drop file con react-dropzone
