# Anonimator

App desktop per la **pseudoanonimizzazione offline** di documenti legali italiani.

Pensata per avvocati e professionisti legali: nessun dato viene mai inviato a server esterni. Tutto il processing avviene localmente sul tuo Mac o PC Windows.

**Versione attuale: 1.1.2**

> **L'app è stata creata in vibe coding e non sono un esperto programmatore — procedi con cautela nell'utilizzo.**

<!-- TODO: aggiungere screenshot dell'app (DropZone, revisione entità, dark mode) -->

---

## Funzionalità

- Riconosce automaticamente nomi di persone, luoghi, organizzazioni, codici fiscali, P.IVA, IBAN, email e numeri di telefono
- Pattern regex specializzati per documenti legali: parti processuali, difensori, indirizzi, date di nascita, numeri documento, firme digitali
- Sostituisce le entità con pseudonimi coerenti in tutto il documento (es. "Mario Rossi" → "M. R." ovunque appaia)
- **Pseudonimi editabili**: nella schermata di revisione puoi modificare manualmente ogni pseudonimo prima di procedere
- Supporta PDF (nativi e scansionati via OCR), DOCX, ODT, TXT e Markdown
- Elaborazione **batch** di più file contemporaneamente con revisione unificata delle entità
- **LLM locale opzionale**: connetti Ollama o LM Studio per migliorare il riconoscimento dei nomi (i dati non escono mai dalla tua macchina)
- **Dark mode**: toggle luna/sole nell'interfaccia, preferenza salvata automaticamente
- 100% offline — nessuna connessione di rete durante l'elaborazione (GDPR compliant)

---

## Installazione

Scarica il file per il tuo sistema dalla pagina [Releases](https://github.com/avvocati-e-mac/anonimator/releases):

| File | Sistema |
|---|---|
| `Anonimator-1.1.2-arm64.dmg` | Mac Apple Silicon (M1/M2/M3/M4) |
| `Anonimator-1.1.2-x64.dmg` | Mac Intel |
| `Anonimator-1.1.2-windows-x64-setup.exe` | Windows 10/11 a 64 bit |

### macOS — passaggi obbligatori

Trascina `Anonimator.app` nella cartella Applicazioni.

Poiché l'app non è firmata né notarizzata, macOS la blocca all'apertura. Esegui questi due comandi nel Terminale **una sola volta** dopo l'installazione:

**1. Disabilita il blocco Gatekeeper:**
```bash
spctl --master-disable
```
Poi apri **Impostazioni di Sistema → Privacy e Sicurezza** e dal menu a tendina seleziona **Dovunque**.

**2. Rimuovi l'app dalla quarantena:**
```bash
sudo xattr -cr /Applications/Anonimator.app
```
> Il comando presume che l'app sia nella cartella Applicazioni. Se l'hai installata altrove, sostituisci il percorso di conseguenza.

Dopo questi passaggi l'app si apre normalmente.

### Windows — passaggi obbligatori

Esegui il file `Anonimator-1.1.2-windows-x64-setup.exe` per installare l'app.

Poiché l'app non è firmata con un certificato Microsoft, Windows Defender SmartScreen mostrerà un avviso. Per procedere:

1. Clicca su **"Ulteriori informazioni"** (o "More info")
2. Clicca su **"Esegui comunque"** (o "Run anyway")

L'installer crea un collegamento nel menu Start e sul Desktop. L'app si disinstalla normalmente da **Impostazioni → App**.

---

## Per sviluppatori — Installazione da sorgente

### Requisiti

- macOS 12+ o Windows 10/11
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

---

## Architettura

- **Electron** (Main process): parsing documenti, NER engine, generazione output
- **React 18 + TypeScript**: interfaccia utente (sandboxed renderer)
- **Transformers.js + ONNX**: modello NER italiano locale (`Laibniz/italian-ner-pii-browser-distilbert`)
- **MuPDF + pdf-lib**: redaction e ricostruzione PDF
- **Tesseract.js**: OCR offline per PDF scansionati

I modelli AI sono bundled nell'app — nessun download avviene all'avvio.

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
tests/          # Test unitari
```

## TODO — Cose da fare

### Bug da correggere

- [ ] **DOCX: problemi di estrazione delle entità** — alcune entità non vengono rilevate correttamente su file .docx reali; verificare parser e pipeline NER su documenti complessi
- [ ] **PDF: pseudonimi brevi spezzati su due righe** — "F. S." viene diviso quando il testo originale è vicino al margine destro (`pdfGenerator.ts`)
- [ ] **PDF: footer "1 di ??" invece del totale pagine** — `pdf-lib` non legge il numero totale di pagine dal PDF originale; richiede lettura da MuPDF
- [ ] **PDF: redaction su token con apostrofo** — es. "D'Angiolino" viene spezzato sull'apostrofo durante la redaction, il testo non viene oscurato completamente

### Miglioramenti

- [ ] **Screenshot nel README** — aggiungere immagini di DropZone, revisione entità e dark mode
- [ ] **Testare DMG x64 su Mac Intel** — il DMG è prodotto ma non ancora testato su hardware Intel reale

### Piattaforme

- [ ] **Supporto Linux** — build e packaging per distribuzioni Linux (`.AppImage` o `.deb`)

### Funzionalità future

- [ ] **Auto-update** — check aggiornamenti opzionale (fuori dal flusso di elaborazione)
- [ ] **Statistiche di elaborazione** — tempi per pagina, modello LLM utilizzato, performance worker NER/LLM, throughput prompt
- [ ] **Aggiunta manuale di entità** — possibilità di aggiungere entità non rilevate da NER/LLM direttamente dalla schermata di revisione
- [ ] **Salvataggio e importazione entità** — esportare/importare il dizionario di sostituzione per riutilizzarlo su documenti della stessa pratica con i medesimi soggetti
- [ ] **Ottimizzazione prompt per modelli piccoli** — prompt specializzato per LLM <9B (es. Phi-3, Gemma 2B) che non gestiscono bene prompt generici lunghi
- [ ] **Ottimizzazione rilevamento entità NER** — valutare alternative/integrazioni a Transformers.js (es. SpaCy via servizio locale, modelli ONNX diversi); richiede approfondimento e studio

---

## Licenza

MIT — vedi [LICENSE](LICENSE)
