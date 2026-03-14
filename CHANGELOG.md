# Changelog

Tutte le modifiche significative al progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [1.3.0] - 2026-03-14

### Novità
- **Integrazione LLM con provider adapter**: refactoring completo del client LLM in provider separati (`OllamaAdapter`, `OpenAiCompatAdapter`) con structured output JSON schema nativo. Risposta LLM più affidabile su tutti i modelli supportati.
- **Page-mode LLM per PDF**: i documenti PDF vengono ora inviati all'LLM pagina per pagina invece che come blocchi di testo continuo. Migliora la precisione su documenti lunghi e riduce i falsi positivi da testo troncato a cavallo di chunk.
- **Porta configurabile per preset custom**: il preset "Custom OpenAI-compat" permette ora di specificare una porta diversa da quella di default, senza dover riscrivere l'URL base completo.
- **Warning per chunk LLM falliti**: se uno o più chunk falliscono silenziosamente durante l'analisi LLM (es. errore 500 mentre LM Studio carica il modello), l'utente vede ora un avviso chiaro con il numero di sezioni non analizzate. Il flusso principale non viene interrotto.

### Fix
- **Context overflow immediato**: su errori 400 causati da context overflow (KV cache esaurita su LM Studio con modelli grandi), il sistema interrompe immediatamente i retry invece di tentare inutilmente.
- **Cap parallelRequests per modelli ≤4B**: per modelli piccoli (Phi-3, Gemma 2B, Qwen 2.5 3B, ecc.) il numero di richieste parallele viene forzato a 1 per evitare overflow della KV cache condivisa su LM Studio. Avviso amber in Impostazioni se il cap è attivo.
- **Terzo tentativo senza response_format**: su modelli 3B che non supportano lo structured output JSON, il terzo tentativo viene inviato senza il vincolo `response_format` per ottenere comunque una risposta parsabile.
- **Prompt NER ripristinato completo**: ripristinate le regole di esclusione complete nel prompt di sistema (istituzioni pubbliche, riferimenti normativi, metadati PKI) che erano state accidentalmente rimosse in una versione precedente.
- **Progresso LLM — terminologia corretta**: il messaggio di avanzamento usa ora "sezione" invece di "pagina" per i documenti non-PDF, e mostra l'indice corretto del chunk corrente.
- **chunkMode rimosso**: il toggle manuale "chunk mode / page mode" è stato rimosso dalle impostazioni. La modalità viene ora selezionata automaticamente in base al formato del documento (PDF → page-mode, altri → chunk-mode).

### Migliorie tecniche
- `llmUsed` viene impostato a `true` solo se almeno un chunk LLM ha avuto successo (in precedenza era sempre `true` anche se tutti i chunk fallivano).
- Aggiunto `modelSizeUtils.ts` (`inferChunkSize`) per il rilevamento automatico della taglia del modello dal nome.
- Test unitari aggiuntivi: `OllamaAdapter`, `OpenAiCompatAdapter` (retry, context overflow, structured output), `modelSizeUtils`, `nerPageMode`, migrazione impostazioni, utilità SettingsScreen.

## [1.2.7] - 2026-03-10

### Fix
- **Fix critico caricamento NER**: risolto l'errore tecnico `Cannot read properties of undefined (reading 'create')` che impediva il caricamento del modello ONNX su alcuni sistemi. Implementato il pre-caricamento del modulo `onnxruntime-node` all'avvio e disabilitato il proxy worker di Transformers.js per una maggiore stabilità in ambiente Electron.
- **Riduzione falsi positivi**: aggiunti "REPUBBLICA", "ITALIANA", "STATO" e "GOVERNO" alla blocklist dei termini tutto-maiuscolo per evitare che riferimenti istituzionali vengano scambiati per nomi di persona.
- **Miglioramento Diagnostica**: i messaggi di errore nella schermata di revisione sono ora più precisi nel distinguere tra modello mancante (da scaricare) ed errore tecnico di caricamento.

## [1.2.6] - 2026-03-10

### Novità
- **Statistiche di sessione**: aggiunta una nuova sezione nella schermata di successo (singola e batch) che mostra il riepilogo dell'elaborazione: numero totale di file, pagine totali processate, tempo trascorso e velocità (throughput in pagine al secondo).
- **Nuovo componente `SessionStatsBanner`**: visualizzazione elegante delle metriche di performance con supporto alla dark mode.

### Migliorie
- **Ottimizzazione store**: aggiunto tracking del timestamp di inizio elaborazione nello `sessionStore` per calcoli precisi sulla durata della sessione.
- **UI/UX**: migliorata la leggibilità delle schermate finali con l'integrazione delle statistiche.

### Fix
- **Stabilità sessione**: risolte alcune inconsistenze nel reset dei contatori quando si aggiungono nuovi file a una sessione esistente.

## [1.2.5] - 2026-03-09

### Fix
- **Fix critico NER ARM64**: Corretto il caricamento del modello ONNX su Mac Apple Silicon risolvendo lerrore di inizializzazione della sessione. Spostato il file del modello nella root della cartella per compatibilità con Transformers.js v3.
- **Configurazione ONNX Runtime**: Forzato luso del backend CPU per una maggiore stabilità su ambienti desktop sandboxed.
- **Migrazione automatica**: I file del modello scaricati con la versione precedente vengono migrati automaticamente al nuovo percorso.

## [1.2.4] - 2026-03-09

### Fix
- **Gestione percorsi (userData)**: centralizzata la ricerca dei modelli NER e dei file Tessdata per l'OCR esclusivamente in `app.getPath('userData')` per una maggiore robustezza su diverse installazioni e sistemi operativi.
- **Diagnostica avanzata**: aggiunto il controllo per i file OCR (`ita.traineddata`) nella schermata delle Impostazioni e nel log di diagnostica, per facilitare il supporto agli utenti.
- **Log diagnostici**: migliorata la registrazione delle informazioni su piattaforma e architettura (ARM64/x64) per accelerare la risoluzione di eventuali problemi di compatibilità.

### Documentazione
- **Aggiornamento README**: riflette ora tutte le funzionalità introdotte nell'ultimo ciclo di sviluppo (entità modificabili, onboarding, batch processing migliorato).

---

## [1.2.3] - 2026-03-09

### Fix
- **Fix NER ARM64 — `env.localModelPath`**: aggiunto `mod.env.localModelPath = getModelPath()` in `tryLoadTransformers()` per garantire che Transformers.js trovi il modello ONNX correttamente sia in sviluppo che in produzione (pacchettizzato). Elimina la causa root del fallback silenzioso ai soli regex su ARM64.

### Novità
- **Entità completamente modificabili**: nella schermata di revisione (singolo file e batch) è ora possibile modificare anche il **tipo** (badge cliccabile che apre un dropdown con tutti gli 11 tipi disponibili) e il **testo originale** (campo cliccabile con icona matita in hover). Prima era modificabile solo il pseudonimo.
- **Schermata di benvenuto (onboarding)**: mostrata al primo avvio, spiega il funzionamento dell'app in tre sezioni (riconoscimento automatico, due livelli di analisi, LLM opzionale) con nota hardware per Mac Apple Silicon. Checkbox "Non mostrare più questo messaggio" per disabilitarla permanentemente.

---

## [1.2.2] - 2026-03-08

### Fix
- **Fix semver ARM64 — approccio corretto**: `semver` aggiunto ad `asarUnpack` in `electron-builder.config.js` invece di usare la patch `Module._resolveFilename`. Rimosso `/semver` dalla patch (era sbagliato — reindirizzava verso un path inesistente).

### Novità
- **Check modello NER all'avvio e pulsante download**: sezione "Modello NER" in Impostazioni che verifica se il modello BERT è presente. Se mancante, mostra badge arancione e pulsante "Scarica modello (~65 MB)" con progress bar per il download da HuggingFace. Al termine, la pipeline NER viene resettata automaticamente e il modello è pronto senza ricompilare.

---

## [1.2.1] - 2026-03-08

### Fix
- **Fix NER ARM64 — semver non trovato da sharp**: la patch `Module._resolveFilename` ora reindirizza anche il modulo `semver` verso `app.asar.unpacked`, risolvendo l'errore `Cannot find module 'semver/functions/coerce'` che disabilitava il NER BERT su macOS ARM64.

---

## [1.2.0] - 2026-03-08

### Novità
- **Diagnostica installazione — pulsante "Copia diagnostica" nelle Impostazioni**: raccoglie versione, piattaforma, presenza modello NER e binding onnxruntime, e le ultime 100 righe del log. Copia tutto negli appunti con un click, pronto da incollare in un'email allo sviluppatore.
- **Script `scripts/check-install.sh`**: script bash standalone per verificare l'installazione su qualsiasi Mac. Controlla modello NER, `onnxruntime_binding.node`, `detect-libc`, binari sharp e tessdata. Output colorato con riepilogo OK/FAIL. Eseguibile anche da remoto con un comando Terminale.

---

## [1.1.9] - 2026-03-08

### Correzioni
- **Fix CI — rimosso `@electron/rebuild` da tutti i job**: `onnxruntime-node` usa binari NAPI pre-built per tutte le piattaforme (darwin/arm64, darwin/x64, linux/x64, win32/x64). Il rebuild li sovrascriveva con quelli sbagliati, lasciando nel pacchetto solo il binding della piattaforma del runner CI (es. `linux/x64` nel DMG macOS). Rimosso il rebuild — i binari multi-piattaforma ora vengono inclusi correttamente dall'`asarUnpack`.
- **Fix smoke test CI — verifica binding piattaforma-specifica**: lo smoke test ora cerca il binding con il path esatto della piattaforma target (`darwin/arm64`, `darwin/x64`, `linux/x64`, `win32/x64`) invece del primo trovato. Questo avrebbe rilevato il problema del rebuild già alla v1.1.7.

---

## [1.1.8] - 2026-03-08

### Correzioni
- **Fix NER macOS — `detect-libc` mancante dall'asar**: `sharp` (importato da `@huggingface/transformers`) non trovava il modulo `detect-libc` perché non era incluso in `asarUnpack`. Aggiunto alla lista dei moduli estratti → NER BERT ora si carica correttamente.

---

## [1.1.7] - 2026-03-08

### Correzioni
- **Fix NER macOS ARM64**: estesa la patch `Module._resolveFilename` in `src/main/index.ts` per reindirizzare verso `app.asar.unpacked` anche i path di `sharp` e `@img/sharp-darwin-*`. Risolve il caso in cui `@huggingface/transformers` non riusciva a caricare il binario sharp ARM64 dall'interno dell'asar, causando la disabilitazione silenziosa del NER BERT.
- **CI/CD — rebuild native modules su tutti i job**: aggiunto `npx @electron/rebuild --force` nei job `build-mac-arm64`, `build-mac-x64` e `build-linux` del workflow GitHub Actions (era già presente solo su Windows).
- **CI/CD — smoke test post-packaging**: aggiunto step di verifica che controlla la presenza di `model_quantized.onnx` e `onnxruntime_binding.node` nel pacchetto prodotto prima dell'upload dell'artefatto, su tutti e 4 i job di build.
- **Diagnostica NER al caricamento**: aggiunto log `NER diagnostics` in `nerService.ts` con `modelPath`, `modelExists`, `resourcesPath`, `platform` e `arch`. Leggibile da `~/Library/Logs/Anonimator/main.log` per debug immediato senza debugger.

---

## [1.1.6] - 2026-03-08

### Correzioni
- **Fix workflow importa dizionario → trascina documento**: quando si importa un dizionario JSON (o si ripristina una sessione), in `EntityReview` appare ora una mini drop zone sopra la lista entità. L'utente può trascinare (o selezionare) il documento da anonimizzare senza uscire dalla schermata e senza perdere le entità importate. Le entità rilevate dall'analisi NER vengono mergeate con quelle importate, e il pulsante "Anonimizza" si abilita automaticamente.

---

## [1.1.5] - 2026-03-08

### Novità
- **Inserimento manuale entità**: in EntityReview e BatchReview è ora possibile aggiungere entità che il NER non ha rilevato (pulsante "Aggiungi"). Il pseudonimo viene generato automaticamente con le stesse regole della sessione.
- **Esporta dizionario**: il pulsante "Esporta" in EntityReview/BatchReview salva tutte le entità rilevate in un file JSON riutilizzabile (`dizionario-entita.json`).
- **Importa dizionario**: il pulsante "Importa" in EntityReview/BatchReview carica un JSON precedentemente esportato. In caso di conflitto il pseudonimo importato ha priorità su quello NER.
- **Sessione persistente**: dopo ogni anonimizzazione il dizionario pseudonimi viene salvato automaticamente su disco (`~/Library/Application Support/Anonimator/anonimator-session.json`). Al prossimo avvio è possibile ripristinarlo senza rianalizzare i documenti.
- **Carica sessione precedente**: nuovo pannello in DropZone con bottone "Carica" (visibile solo se esiste il file) e bottone "Elimina" (con conferma) per cancellare i dati personali in chiaro dal file sessione.
- **Importa da DropZone**: nuovo pannello "Importa dizionario entità" in DropZone per caricare un file JSON e passare direttamente alla schermata di revisione senza analisi NER.

---

## [1.1.4] - 2026-03-07

### Correzioni
- **Fix Windows 10 — crash onnxruntime (tentativo v2)**: doppio fix per il crash `Impossibile trovare il modulo specificato` su Windows 10:
  1. `electron-builder.config.js`: pattern `asarUnpack` per `onnxruntime-node` esteso con `node_modules/onnxruntime-node/**` (senza `/*` finale) e pattern esplicito `node_modules/onnxruntime-node/dist/**` per garantire che `dist/binding.js` finisca in `app.asar.unpacked`. Su Win10, Electron non fa il fallover automatico da asar verso asar.unpacked per i file JS: `binding.js` deve essere fisicamente fuori dall'asar.
  2. `nerService.ts`: l'import di `@huggingface/transformers` è ora dinamico (`await import(...)`) con try/catch. Se onnxruntime non è caricabile per qualunque motivo, l'app non crasha ma continua con solo le regex (CF, P.IVA, IBAN, email, telefono, pattern legali strutturati). Il warning viene loggato in `electron-log`.

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
