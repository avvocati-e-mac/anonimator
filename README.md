# Anonimator

App desktop per la **pseudoanonimizzazione offline** di documenti legali italiani.

Pensata per avvocati e professionisti legali: nessun dato viene mai inviato a server esterni. Tutto il processing avviene localmente sul tuo Mac, PC Windows o Linux.

**Versione attuale: 1.5.0**

> **L'app è stata creata in vibe coding e non sono un esperto programmatore — procedi con cautela nell'utilizzo.**

<!-- TODO: aggiungere screenshot dell'app (DropZone, revisione entità, dark mode) -->

---

## Indice

- [Funzionalità](#funzionalità)
- [Installazione](#installazione)
  - [macOS](#macos--passaggi-obbligatori)
  - [Windows](#windows--passaggi-obbligatori)
  - [Linux](#linux--installazione)
  - [Verifica installazione (macOS)](#verifica-installazione-macos)
- [Per sviluppatori](#per-sviluppatori--installazione-da-sorgente)
- [Architettura](#architettura)
- [TODO](#todo--cose-da-fare)
- [Licenza](#licenza)

---

## Funzionalità

- Riconosce automaticamente nomi di persone, luoghi, organizzazioni, codici fiscali, P.IVA, IBAN, email, numeri di telefono, **targhe veicoli** e numeri documento
- Pattern regex specializzati per documenti legali: parti processuali, difensori, indirizzi, date di nascita, numeri documento, titoli professionali (Avv., Ing., Dott., Prof., ecc.), firme digitali
- **Organizzazioni opzionali**: le aziende/società rilevate dal modello NER appaiono deselezionate di default — l'utente le seleziona manualmente se vuole anonimizzarle (non sono dati personali obbligatori)
- **Co-reference resolution**: riconosce automaticamente le occorrenze successive di un nome (es. "Rossi" dopo "Mario Rossi") e le sostituisce con lo stesso pseudonimo
- **Veto filter ruoli processuali**: i termini come "RICORRENTE", "APPELLANTE", "IMPUTATO" non vengono mai anonimizzati anche se il modello BERT li classifica erroneamente come persone
- Sostituisce le entità con pseudonimi coerenti in tutto il documento (es. "Mario Rossi" → "M. R." ovunque appaia)
- **Entità completamente modificabili**: nella schermata di revisione puoi modificare il tipo (badge cliccabile con dropdown), il testo originale da cercare nel documento (icona matita in hover) e il pseudonimo sostitutivo
- **Aggiunta manuale entità**: aggiungi nomi o soprannomi che il NER non ha rilevato direttamente dalla schermata di revisione
- **Esporta/Importa dizionario**: salva le entità e i pseudonimi in un file JSON (il nome del file rispecchia quello del documento originale) e riutilizzali su documenti della stessa pratica
- **Sessione persistente**: il dizionario pseudonimi viene salvato automaticamente dopo ogni anonimizzazione; al prossimo avvio puoi ripristinarlo con un clic senza rianalizzare i documenti. Dopo il ripristino, trascina il documento direttamente nella schermata di revisione per anonimizzare senza perdere le entità importate
- **Statistiche di sessione**: visualizza il numero di file e pagine processate, il tempo totale e la velocità di elaborazione (pagine al secondo) nella schermata finale di successo
- Supporta PDF (nativi e scansionati via OCR), DOCX, ODT, TXT e Markdown
- Elaborazione **batch** di più file contemporaneamente con revisione unificata delle entità
- **LLM locale opzionale**: connetti Ollama o LM Studio per migliorare il riconoscimento dei nomi (i dati non escono mai dalla tua macchina); se il server restituisce un errore durante l'elaborazione, l'app continua e mostra un avviso con il numero di sezioni non analizzate
- **Schermata di benvenuto**: al primo avvio spiega il funzionamento dell'app (tre livelli di analisi, nota hardware per LLM) — disattivabile con un checkbox
- **Dark mode**: toggle luna/sole nell'interfaccia, preferenza salvata automaticamente
- **Diagnostica installazione**: pulsante "Copia diagnostica" nelle Impostazioni — raccoglie versione, piattaforma e ultime righe del log (mai contenuto dei documenti) e li copia negli appunti pronti da inviare allo sviluppatore
- **Download modello NER integrato**: se il modello di riconoscimento entità (BERT, ~65 MB) è assente, le Impostazioni mostrano un badge di avviso e un pulsante per scaricarlo direttamente nell'app, con progress bar e feedback visivo
- 100% offline — nessuna connessione di rete durante l'elaborazione (GDPR compliant)

---

## Installazione

Scarica il file per il tuo sistema dalla pagina [Releases](https://github.com/avvocati-e-mac/anonimator/releases):

| File | Sistema |
|---|---|
| `Anonimator-1.5.0-arm64.dmg` | Mac Apple Silicon (M1/M2/M3/M4) |
| `Anonimator-1.5.0-x64.dmg` | Mac Intel |
| `Anonimator-1.5.0-windows-x64-setup.exe` | Windows 10/11 a 64 bit |
| `Anonimator-1.5.0-linux-x64.AppImage` | Linux a 64 bit |

### Per tutti i sistemi

L’app al primo avvio scarica circa 80 Mb di modello NER e Tesseract per OCR PDF

### macOS — passaggi obbligatori

Trascina `Anonimator.app` nella cartella Applicazioni.

Poiché l'app non è firmata né notarizzata, macOS la blocca all'apertura. Esegui questi due comandi nel Terminale **una sola volta** dopo l'installazione:

**1. Rimuovi l'app dalla quarantena:**
```bash
sudo xattr -cr /Applications/Anonimator.app
```
> Il comando presume che l'app sia nella cartella Applicazioni. Se l'hai installata altrove, sostituisci il percorso di conseguenza.

Dopo questo passaggio l'app si apre normalmente.


### Windows — passaggi obbligatori

Esegui il file `Anonimator-1.3.0-windows-x64-setup.exe` per installare l'app.

Poiché l'app non è firmata con un certificato Microsoft, Windows Defender SmartScreen mostrerà un avviso. Per procedere:

1. Clicca su **"Ulteriori informazioni"** (o "More info")
2. Clicca su **"Esegui comunque"** (o "Run anyway")

L'installer crea un collegamento nel menu Start e sul Desktop. L'app si disinstalla normalmente da **Impostazioni → App**.

### Linux — installazione

Scarica il file `.AppImage`, rendilo eseguibile e avvialo:

```bash
chmod +x Anonimator-1.3.0-linux-x64.AppImage
./Anonimator-1.3.0-linux-x64.AppImage
```

> Su alcune distribuzioni potrebbe essere necessario installare `libfuse2` (`sudo apt install libfuse2` su Ubuntu/Debian).

---

## Per sviluppatori — Installazione da sorgente

### Requisiti

- macOS 12+, Windows 10/11 o Linux (x64)
- Node.js 20+ e npm 10+
- Circa 200 MB di spazio per il modello NER e i dati OCR

### Setup

```bash
# 1. Clona il repository
git clone https://github.com/avvocati-e-mac/anonimator.git
cd anonimator

# 2. Installa le dipendenze Node.js
npm install

# 3. Scarica il modello NER e il file tessdata per OCR
bash scripts/download-models.sh

# 4. Avvia l'app in modalità sviluppo
npm start
```

### Comandi disponibili

| Comando | Descrizione |
|---|---|
| `npm start` | Avvia l'app in modalità sviluppo |
| `npm test` | Esegue i test unitari (vitest) |
| `npm run typecheck` | Verifica TypeScript senza compilare |
| `npm run dist:mac:arm64` | Crea il DMG per macOS Apple Silicon |
| `npm run dist:mac:x64` | Crea il DMG per macOS Intel |
| `npm run dist:mac:both` | Crea entrambi i DMG (arm64 + x64) in sequenza |
| `npm run dist:linux` | Crea l'AppImage per Linux x64 |

---

## Architettura

- **Electron** (Main process): parsing documenti, NER engine, generazione output
- **React 18 + TypeScript**: interfaccia utente (sandboxed renderer)
- **Transformers.js + ONNX**: modello NER italiano locale (`DeepMount00/Italian_NER_XXL_v2`)
- **MuPDF + pdf-lib**: redaction e ricostruzione PDF
- **Tesseract.js**: OCR offline per PDF scansionati

**Pipeline NER (3 livelli):**
1. **Regex contestuali** (`regexPatterns.ts`): 12 pattern specifici per documenti legali italiani (parti processuali, difensori, firme PKI, ecc.)
2. **BERT locale** (`Italian_NER_XXL_v2` ONNX): chunking sliding window con overlap 40 token, cache chunk SHA-256, veto filter ruoli processuali, score boosting cross-layer, co-reference resolution
3. **LLM locale** (opzionale, Ollama/LM Studio): livello aggiuntivo configurabile dall'utente

I modelli AI (NER e OCR) vengono scaricati automaticamente al primo avvio o tramite le Impostazioni per ridurre la dimensione iniziale dell'app. L'elaborazione successiva rimane 100% offline.

## Struttura del progetto

```
src/
  main/         # Processo Node.js (parser, NER, output generators)
  preload/      # contextBridge (API renderer → main)
  renderer/     # App React (sandboxed, zero Node.js access)
  shared/       # Tipi TypeScript condivisi (IPC contracts)
resources/
  models/       # Modello ONNX NER (scaricato da download-models.sh)
  tessdata/     # Dati OCR italiano (scaricato da download-models.sh)
scripts/
  download-models.sh  # Script di setup modelli
  build-mac.sh        # Script build DMG arm64 + x64
  check-install.sh    # Script diagnostica installazione (verifica modelli, binding, log)
tests/          # Test unitari
```

## TODO — Cose da fare

### Bug da correggere

- [x] **PDF scansionati: output vuoto/corrotto** — risolto in v1.3.2. Il generatore ora usa OCR word-level (MuPDF + Tesseract) per localizzare le entità e sovrappone rettangoli grigi direttamente sull'immagine raster del PDF.
- [x] **NER non disponibile su Windows 10 / ARM64** — risolto l'errore tecnico `Cannot read properties of undefined (reading 'create')` tramite pre-caricamento del modulo nativo e disabilitazione del proxy worker.
- [x] **DOCX: parser riscritto con mammoth** — estrattore testo sostituito con mammoth; run-split, tabelle, content controls e tracked changes gestiti nativamente
- [x] **DOCX: multi-entità nello stesso paragrafo** — fix docxGenerator: algoritmo token-based garantisce la sostituzione corretta di N entità nello stesso `<w:t>` senza perdita di testo
- [ ] **PDF: pseudonimi brevi spezzati su due righe** — "F. S." viene diviso quando il testo originale è vicino al margine destro (`pdfGenerator.ts`)
- [ ] **PDF: footer "1 di ??" invece del totale pagine** — `pdf-lib` non legge il numero totale di pagine dal PDF originale; richiede lettura da MuPDF
- [ ] **PDF: redaction su token con apostrofo** — es. "D'Angiolino" viene spezzato sull'apostrofo durante la redaction, il testo non viene oscurato completamente

### Miglioramenti

- [ ] **Screenshot nel README** — aggiungere immagini di DropZone, revisione entità e dark mode
- [ ] **Testare DMG x64 su Mac Intel** — il DMG è prodotto ma non ancora testato su hardware Intel reale

### Piattaforme

- [x] **Supporto Linux** — build AppImage x64 disponibile dalla v1.1.3

### Funzionalità future

- [ ] **Auto-update** — check aggiornamenti opzionale (fuori dal flusso di elaborazione)
- [x] **Statistiche di elaborazione** — tempi per pagina, numero pagine, throughput (pag/s) nella schermata di successo
- [x] **Aggiunta manuale di entità** — possibilità di aggiungere entità non rilevate da NER/LLM direttamente dalla schermata di revisione
- [x] **Salvataggio e importazione entità** — esportare/importare il dizionario di sostituzione per riutilizzarlo su documenti della stessa pratica con i medesimi soggetti
- [ ] **Ottimizzazione prompt per modelli piccoli** — prompt specializzato per LLM <9B (es. Phi-3, Gemma 2B) che non gestiscono bene prompt generici lunghi
- [x] **Ottimizzazione rilevamento entità NER** — migliorata la pipeline NER con co-reference resolution, veto filter ruoli processuali, score boosting cross-layer, sliding-window chunking, cache chunk NER (v1.4.x)
- [x] **Riconoscimento targa veicolo** — nuovo tipo entità TARGA con pattern italiano (v1.5.0)
- [x] **Blocklist intestazioni legali** — `PREMESSO CHE`, `SVOLGIMENTO DEL PROCESSO`, ecc. non vengono più anonimizzati per errore (v1.5.0)

---

## Licenza

MIT — vedi [LICENSE](LICENSE)
