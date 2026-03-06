# Changelog

Tutte le modifiche significative al progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [1.0.7] - 2026-03-06

### Novità
- **Dark mode**: aggiunta modalità scura con toggle luna/sole nella DropZone (e nella schermata Impostazioni). Preferenza persistita in `localStorage`. Script anti-FOUC per evitare il flash al riavvio.

### Bug Fix
- **Impostazioni LLM — campo Host**: il campo "Host" non mostra più la porta (`192.168.1.125:1234`) quando si ricarica una configurazione salvata con IP non-localhost. Ora mostra correttamente solo l'indirizzo IP.
- **Annulla in ProcessingScreen**: aggiunto pulsante "Annulla" durante l'analisi del documento. Permette di tornare alla dropzone se l'analisi si blocca o richiede troppo tempo.
- **Annulla in EntityReview**: il pulsante "Annulla" ora esegue un reset completo dello store (in precedenza `filePath` ed `entities` rimanevano nello stato sporco causando comportamenti anomali al drop successivo). Stesso fix applicato in BatchReview.

---

## [1.0.6] - 2026-03-06

### Bug Fix
- **Build macOS arm64**: risolto crash all'avvio "Could not load the sharp module using the darwin-arm64 runtime". I binari nativi `@img/sharp-darwin-arm64` non venivano inclusi nel DMG perché la macchina di build è x64. Lo script `dist:mac:arm64` ora installa esplicitamente i binari arm64 con `--force` prima del packaging.

---

## [1.0.5] - 2026-03-06

### Bug Fix
- **Caricamento multiplo**: ripristinato il supporto al drop/selezione di più file contemporaneamente (batch processing). Il reset del repo per la pubblicazione GitHub aveva lasciato `App.tsx`, `sessionStore.ts` e `DropZone.tsx` alla versione pre-batch.
- **Versione app**: corretta la versione mostrata nell'interfaccia (era bloccata a 1.0.2).

### Tecnico
- Aggiunti tipi batch mancanti in `types.ts` (`BatchFileItem`, `BatchResultItem`, `BatchSettings`, ecc.)
- Aggiunto canale IPC `BATCH_ANONYMIZE` e relativo handler nel main process
- Aggiunta funzione `batchAnonymize` nel preload e nella tipizzazione `ElectronAPI`

---

## [1.0.2] - 2026-03-05

### Bug Fix
- **Drop file**: risolto errore "Impossibile leggere il percorso del file" quando si trascinava un file nella finestra dell'app. Il problema era che `react-dropzone` clonava i `File` objects prima di passarli al callback, rendendo `webUtils.getPathForFile` incapace di recuperare il path assoluto. Soluzione: intercettazione dell'evento `drop` nativo in capture phase per salvare il path prima che `react-dropzone` elabori i file.

---

## [1.0.1] - 2026-03-05

### Novità
- Label versione app nell'angolo in alto a sinistra della schermata principale (formato "v. 1.0.1")
- Versione letta via IPC dal main process (`app.getVersion()`) invece che dal preload sandboxed

### Modifiche
- Spostato il label versione dall'angolo in alto a destra a quello in alto a sinistra

---

## [1.0.0] - 2026-03-05

### Novità (rilascio iniziale)
- Anonimizzazione offline di documenti legali italiani (PDF, DOCX, ODT, TXT, PNG, JPG)
- NER ibrido: modello ONNX `Laibniz/italian-ner-pii-browser-distilbert` + regex per dati strutturati (CF, P.IVA, IBAN, email, telefono)
- Integrazione LLM locale opzionale (Ollama / LM Studio) per rilevamento aggiuntivo
- Pseudonimi con iniziali per persone e organizzazioni (es. "Filippo Strozzi" → "F. S.")
- PDF: redazione fisica del testo via MuPDF + sovrascrizione con pseudonimo grigio via pdf-lib
- Output DOCX, ODT, TXT con sostituzione XML in-memory
- UI drag & drop con revisione entità prima dell'anonimizzazione
- Gestione sessione: pseudonimi coerenti su documenti multipli nella stessa sessione
- Impostazioni LLM accessibili dall'icona ingranaggio
- Packaging macOS (DMG universale arm64/x64)
- Icona app (robot arancione)
