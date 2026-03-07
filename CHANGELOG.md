# Changelog

Tutte le modifiche significative al progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [1.1.3] - 2026-03-07

### Novità
- **Supporto Linux**: aggiunto target di build AppImage (x64) per distribuire l'app su Linux. Nuovo script `dist:linux` in package.json.

---

## [1.1.2] - 2026-03-07

### Correzioni
- **Fix Windows — crash onnxruntime su Win 10**: aggiunta patch `Module._resolveFilename` all'avvio del main process che reindirizza il caricamento dei file `.node` e di `onnxruntime` da `app.asar` verso `app.asar.unpacked`. Su Windows 10, `dlopen()` non riesce a caricare moduli nativi dall'interno di un archivio asar anche quando correttamente configurato in `asarUnpack`.

---

## [1.1.1] - 2026-03-07

### Correzioni
- **Fix Windows — PDF worker URL**: il path del worker pdfjs-dist viene ora convertito in `file://` URL tramite `pathToFileURL()`. In precedenza su Windows il path assoluto `C:\...` causava l'errore "Only URLs with a scheme in: file, data, node, and electron are supported" e nessun PDF poteva essere aperto.
- **Fix Windows — onnxruntime_binding.node**: aggiunto `npx @electron/rebuild --force` nel job CI `build-windows` per ricompilare i moduli nativi con l'ABI di Electron corretto. Risolve il crash all'avvio "Impossibile trovare il modulo specificato" su Windows 10/11.

---

## [1.1.0] - 2026-03-07

### Correzioni
- **Fix critico DOCX/ODT — run-split**: il generator sostituisce ora correttamente le entità anche quando il testo è spezzato in più run XML (`<w:r>` / `<text:span>`). In precedenza le entità venivano rilevate correttamente ma non sostituite nel file di output.
- **Fix apostrofi tipografici TXT**: normalizzazione `'` (U+2019) e simili prima della ricerca; consente il match tra entità con apostrofo dritto e testo del documento con apostrofo curvo.
- **Fix encoding TXT**: fallback automatico a `latin1` se la lettura UTF-8 del file sorgente fallisce.

### Novità
- **Supporto file Markdown (`.md`)**: i file Markdown vengono ora accettati, analizzati (con strip della sintassi MD per il NER) e anonimizzati preservando intestazioni, grassetto, link e tutto il markup originale.

---

## [1.0.9] - 2026-03-07

### Correzioni
- **Fix critico: modello NER mancante nei DMG rilasciati** — il modello ONNX non era incluso nel pacchetto perché assente al momento della build CI. Il workflow scarica ora automaticamente il modello da HuggingFace prima del packaging.

### Novità
- **NER ibrido — 11 nuovi pattern regex per documenti legali**: il motore di riconoscimento aggiunge ora un layer di regex specializzate per tipo documento che operano prima del modello BERT, aumentando significativamente il recall su sentenze, contratti, atti fallimentari, polizze e perizie.
  - Parti processuali: ricorrente, appellante, attore, convenuto, debitore, creditore e altri ruoli
  - Avvocati difensori in formato lista ("avvocati NOME A, NOME B")
  - Nomi tutto-maiuscolo su riga propria (intestazioni atti)
  - Data di nascita, indirizzo di residenza/domicilio, numero documento d'identità
  - Contraente/Assicurato/Beneficiario (polizze), parti contrattuali, Paziente/CTU/Perito
  - Firmatari digitali (riga "Firmato Da: COGNOME NOME Emesso Da:" nei PDF firmati con ArubaPEC)
- **Tre nuovi tipi di entità**: Data di nascita (`NASC_001`), Indirizzo (`IND_001`), Numero documento (`DOC_001`), con badge colorati nella schermata di revisione
- **Ottimizzazione prompt LLM**: prompt IT e EN riscritti (~40% più corti) con bookending, esempi espliciti e lista precisa di esclusioni (istituzioni pubbliche, riferimenti normativi, metadati PKI)
- **UI Impostazioni LLM avanzate**: dropdown modelli suggeriti (Mistral 7B, Llama 3.2 3B, Qwen 2.5 3B, Phi 3.5 Mini), toggle lingua prompt (IT/EN), slider dimensione chunk, textarea prompt personalizzato

### Bug Fix
- Filtro post-BERT migliorato: soglie score differenziate per tipo etichetta (PER 0.50, ORG 0.60, LOC 0.65); eliminati falsi positivi da frammenti PKI (NG, CA, G3) e da nomi di istituzioni pubbliche
- Fix Step 6 deduplicazione: un'entità corta (es. "Strozzi") non viene più eliminata erroneamente quando appare in modo autonomo nel testo, anche se è sottostringa di un'entità più lunga ("Studio Legale Strozzi")
- Fix `parallelRequests` mancante dallo schema Zod in `ipcHandlers.ts`

---

## [1.0.8] - 2026-03-07

### Novità
- **Release automatica su GitHub Actions**: la build e la pubblicazione dei file di installazione (DMG arm64, DMG x64, .exe Windows) avvengono automaticamente al push di un tag `vX.Y.Z`.

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
