# Sessione 006 — Output Generators + Fix NER + Fix PDF Worker

**Data:** 2026-03-05
**Stato:** COMPLETATA

## Fix applicati in questa sessione

### Fix 1: PDF Worker path errato
**Problema:** `import.meta.url` in `out/main/index.js` risaliva a `Downloads/node_modules` invece di `Downloads/Programma anonimizzazione/node_modules`
**Fix:** `require.resolve('pdfjs-dist/legacy/build/pdf.mjs')` + `path.dirname()` in `pdfParser.ts`

### Fix 2: PDF Missing PDF (URL encoding)
**Problema:** `url: filePath` causava "Missing PDF" con spazi nel path (URL encoding `%20`)
**Fix:** `fs.readFile(filePath)` → `new Uint8Array(buffer)` → `data:` nel pdfjs.getDocument()

### Fix 3: File path relativo dal drag & drop
**Problema:** `file.path` dava `./nome.pdf` (relativo) invece del path assoluto
**Fix:** `webUtils.getPathForFile(file)` esposto via contextBridge come `getPathForFile`
- Aggiornato `src/preload/index.ts` (import webUtils, esposto)
- Aggiornato `src/renderer/src/env.d.ts` (tipo aggiunto)
- Aggiornato `src/renderer/src/components/DropZone.tsx` (usa `window.electronAPI.getPathForFile`)

### Fix 4: Modello NER (DeepMount00 → Laibniz)
**Problema:** `DeepMount00/Italian_NER_XXL_v2` non ha ONNX (solo safetensors)
**Fix:** Scaricato `Laibniz/italian-ner-pii-browser-distilbert` (65MB ONNX quantizzato)
- Salvato in `resources/models/italian-ner-xxl-v2/onnx/model.onnx`
- Label: PER → PERSONA, LOC → LUOGO, ORG → ORGANIZZAZIONE (nessun prefisso BIO)
- Aggiornato mapping in `nerService.ts`

### Fix 5: Aggregazione token NER
**Problema:** Token consecutivi aggregati senza limite → nomi composti errati (es. "Luca Bianchi Mario Rossi")
**Fix:** `MAX_WORDS = 5` nel loop di aggregazione; token `O` chiudono entità corrente
**Fix deduplicazione:** Scarta entità più lunghe che contengono come sottostringa una più corta della stessa categoria

### Fix 6: nerService — allEntities deve essere let
**Modifica:** `let allEntities` per permettere il filter di deduplicazione

## Output Generators implementati (Fase 3b/4b)

### File creati
- `src/main/outputGenerators/txtGenerator.ts` — sostituzione testo, salva `_anonimizzato.txt`
- `src/main/outputGenerators/docxGenerator.ts` — sostituzione XML in word/document.xml, salva `_anonimizzato.docx`
- `src/main/outputGenerators/odtGenerator.ts` — sostituzione XML in content.xml, salva `_anonimizzato.odt`
- `src/main/outputGenerators/pdfGenerator.ts` — estrae testo, anonimizza, ricrea PDF con pdf-lib, salva `_anonimizzato.pdf`
- `src/main/outputGenerators/index.ts` — router per formato

### File modificati
- `src/main/ipcHandlers.ts` — sostituito stub con chiamata a `generateOutput()`
- `src/main/parsers/pdfParser.ts` — fix worker path + fix data loading

### Logica sostituzione (txtGenerator.replaceEntities)
- Ordina entità per lunghezza decrescente (evita sostituzioni parziali)
- Regex case-insensitive
- Esportata e riusata da docxGenerator, odtGenerator, pdfGenerator

### Logica PDF generator
- Riestrare testo dal parser (parsePdf chiamato di nuovo)
- Anonimizza il testo estratto
- Crea nuovo PDF A4 con pdf-lib (Helvetica 11pt, margin 50pt, wrap automatico)
- Metadati: titolo, producer "LegalShield Anonimizzatore", data creazione

## Problema aperto: NER taglia nomi composti
- "Luca Bianchi" viene rilevato come solo "Bianchi" in alcuni contesti
- Limite del modello DistilBERT base su testo legale
- Da testare con altri documenti
- Possibile fix futuro: post-processing che espande al token precedente se è un nome proprio

## Stato TypeScript
- Zero errori (`npx tsc --noEmit`)

## Test flusso completo PDF — problemi trovati e fix

### Problema 1: PDF generato con layout completamente diverso
**Causa:** il generatore ricostruiva il PDF da zero con testo estratto → perdita totale di formattazione
**Fix:** approccio redaction-box — carica PDF originale con pdf-lib, disegna rettangoli bianchi sulle entità, scrive pseudonimo sopra

### Problema 2: "Mostra nella cartella" dava errore
**Causa:** `shell.showItemInFolder` nel preload con sandbox=true non funziona
**Fix:** spostato nel main process via IPC `shell:showInFolder`
- `src/preload/index.ts`: rimosso import shell, usa `ipcRenderer.invoke('shell:showInFolder', filePath)`
- `src/main/ipcHandlers.ts`: aggiunto handler `shell:showInFolder` con `shell.showItemInFolder`

### Problema 3: findTokenGroups cercava match esatti → solo 3/9 entità sostituite
**Causa:** i token PDF sono frasi intere (es. "avv. Mario Rossi") non singole parole
**Fix completo in pdfGenerator.ts:**
- `findEntityInTokens`: cerca entità come **substring** dentro i token (indexOf case-insensitive)
- Calcola x esatta del match proporzionalmente alla larghezza del token
- Gestisce token spezzati a fine riga (es. "Stroz-" + "zi")
- Rettangolo con bordo grigio + padding generoso + pseudonimo centrato verticalmente

### Problema 4: "Filippo Strozzi" e "FILIPPO STROZZI" non rilevati dal NER
**Causa 1:** threshold NER troppo alto (0.75) — il modello dava score < 0.75 per alcuni nomi
**Fix:** abbassato threshold a 0.60 in `nerService.ts`
**Causa 2:** varianti maiuscole (intestazioni) non trovate dal NER che processa testo normalizzato
**Fix:** dopo il NER, cerca varianti `.toUpperCase()` delle entità trovate nel testo originale e le aggiunge con stesso pseudonimo

### Stato attuale
- App riavviata con tutti i fix
- Da testare: entità nella lista (atteso: Filippo Strozzi + FILIPPO STROZZI), PDF output leggibile

## Risultato finale sessione
- 9/9 entità sostituite, nessun errore
- Layout originale preservato, pseudonimi nelle posizioni corrette

## Problemi residui da affrontare (prossima sessione)
1. "Filippo Strozzi" e "avv. Filippo Strozzi" non rilevati dal NER (modello non lo classifica come PERSONA)
2. "Matteo Menozzi" non rilevato
3. Rettangoli talvolta troppo larghi (CF dentro testo lungo)
4. "1 di ??" nel footer — pdf-lib non legge il totale pagine dal PDF originale
5. Testare DOCX e ODT
6. Fase 6: packaging electron-builder (dmg Mac, exe Windows)
