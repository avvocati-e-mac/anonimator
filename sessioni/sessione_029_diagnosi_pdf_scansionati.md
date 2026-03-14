# Sessione 029 — Diagnosi PDF scansionati + NER Windows

**Data:** 2026-03-07
**Versione:** 1.1.4 (nessuna modifica codice in questa sessione)

---

## Problemi rilevati

### Problema 1 — PDF scansionati: output vuoto/corrotto

**File testati:**
- `/Users/filippostrozzi/Downloads/_20260226_snpen@s50@a2026@n07713@tS.clean_anonimizzato.pdf` — 4 pagine, 0 caratteri
- `/Users/filippostrozzi/Downloads/2026 03 03 Ricorso_anonimizzato.pdf` — 8 pagine, 0 caratteri, "syntax error: expected object number"
- `/Users/filippostrozzi/Downloads/_20260226_snciv@s50@a2026@n04406@tO.clean.pdf` (originale) — 9 pagine, 0 caratteri in MuPDF (= PDF raster puro)

**Diagnosi:**

Il flusso per PDF scansionati è:
1. `parsePdf()` → `isScanned=true` → `parsePdfWithOcr()` → testo via Tesseract (solo testo, no coordinate)
2. Utente rivede entità → clicca "Anonimizza"
3. `generatePdf()` usa MuPDF `page.search(entity.originalText)` sul PDF originale
4. MuPDF trova zero risultati (il testo è nelle immagini raster, non nel layer testo)
5. Zero redaction boxes → `applyRedactions()` rimuove il layer testo vuoto → `pdf-lib` non disegna nulla
6. Output: PDF con immagini intatte ma layer testo distrutto → non si apre o appare vuoto

**Root cause:** `generatePdf()` non sa se il PDF era scansionato. La flag `isScanned` viene persa dopo il parsing e non arriva al generatore.

**Soluzione pianificata (minima, un solo file):**

In `src/main/outputGenerators/pdfGenerator.ts`, dopo il loop MuPDF:
- Se `redactionBoxes.length === 0` su tutte le pagine → zero entità trovate nel layer testo
- Fallback: ri-eseguire `parsePdfWithOcr()` sul file originale, sostituire le entità nel testo, produrre `_anonimizzato.txt`
- Return path del TXT con warning "PDF scansionato: output in formato TXT"
- Il `SaveResult` ha già `outputPath: string` — basta cambiare l'estensione

Questo approccio:
- Non tocca `ipcHandlers.ts`, `types.ts`, né il renderer
- Funziona anche per PDF ibridi (poche pagine con testo + pagine raster)
- Compatibile con il flusso batch

---

### Problema 2 — NER non carica su Windows 10 (v1.1.4)

Da screenshot di Andrea (sessione_028): avviso giallo "Modello NER non disponibile. Solo dati strutturati (CF, IBAN, ecc.) rilevati automaticamente."

Fix 1 (asarUnpack) + Fix 2 (import dinamico) in v1.1.4 hanno evitato il crash, ma onnxruntime non si avvia.

**Prossimo passo diagnostico:**
Chiedere ad Andrea di verificare se `dist/binding.js` ora è in `app.asar.unpacked`:
`C:\Users\andrea\AppData\Local\Programs\Anonimator\resources\app.asar.unpacked\node_modules\onnxruntime-node\dist\binding.js`

Se il file c'è → problema DLL → installare Visual C++ Redistributable 2022 x64
Se il file manca → Fix 1 non ha funzionato → investigare electron-builder asarUnpack

---

## File da modificare nella prossima sessione

| File | Modifica |
|------|----------|
| `src/main/outputGenerators/pdfGenerator.ts` | Fallback TXT per PDF scansionati |
| `package.json` | Bump → 1.1.5 |
| `CHANGELOG.md` | Sezione v1.1.5 |

---

## Note aggiuntive

- `ocrParser.ts`: usa `require('canvas')` con try/catch per renderizzare le pagine PDF — node-canvas non è dipendenza diretta. Se non installato, usa testo digitale come fallback.
- `parsePdfWithOcr()` usa `pdfjs.getDocument({ url: filePath })` — path con spazi su Windows potrebbe dare problemi (vedi fix v1.1.1 in `pdfParser.ts` che usa `data: Uint8Array`). Da verificare.
- Il fallback TXT deve usare `parsePdfWithOcr()` già esistente in `ocrParser.ts` — non duplicare codice.
