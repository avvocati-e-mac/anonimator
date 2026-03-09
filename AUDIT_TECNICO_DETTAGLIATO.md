# Audit Tecnico Dettagliato: Anonimator (v1.2.3)

Questo audit fornisce un'analisi approfondita dell'architettura, della sicurezza e della qualità del codice dell'applicazione, identificando aree di miglioramento e best practice per lo sviluppo con Electron.

---

## 1. Architettura & Struttura Progetto

### 🟢 Stato Attuale
L'app utilizza lo stack moderno `electron-vite` con React e TypeScript. La separazione tra Main, Preload e Renderer segue i canoni di sicurezza di Electron.

### 🔴 Criticità: La Patch dei Modelli Nativi (`index.ts`)
È presente una patch manuale per `Module._resolveFilename` che intercetta i caricamenti di moduli come `onnxruntime-node` e `sharp`. 
- **Problema:** Questo indica che i moduli nativi non vengono caricati correttamente dall'ASAR (il formato compresso di Electron).
- **Rischio:** Fragilità negli aggiornamenti di Electron e possibili crash su piattaforme diverse (Windows vs macOS ARM64).
- **Soluzione:** Verificare la configurazione `asarUnpack` in `electron-builder.config.js`. I moduli nativi dovrebbero essere estratti automaticamente senza bisogno di patch al runtime.

---

## 2. Main Process & Comunicazione (IPC)

### ⚠️ Debito Tecnico: "God Object" `nerService.ts`
Il file `nerService.ts` è diventato troppo grande (oltre 700 righe) e svolge troppi compiti:
1. Configurazione percorsi modelli.
2. Logica di download.
3. Regex strutturate legali.
4. Integrazione BERT (Transformers.js).
5. Integrazione LLM.
6. Post-processing e deduplicazione.

**Raccomandazione:** Scomporre il file in moduli specializzati (es. `ner-regex.ts`, `ner-bert.ts`, `ner-utils.ts`). Questo rende il codice più testabile e meno incline a bug "nascosti".

### ⚠️ Efficienza: Elaborazione Sequenziale (Batch)
In `ipcHandlers.ts`, l'anonimizzazione batch (`BATCH_ANONYMIZE`) processa i file uno alla volta in un ciclo bloccante.
- **Problema:** Se un file è molto pesante, il Main Process è occupato e l'app non può rispondere ad altri comandi.
- **Soluzione:** Utilizzare i **Worker Threads** di Node.js per spostare il carico computazionale fuori dal thread principale di Electron.

---

## 3. Gestione Risorse & Servizi Core

### 🔍 Analisi NER & Regex
Le regex come `SENTENCE_HEADER_PATTERN` sono molto specifiche e "fragili". Sebbene utili per tamponare i limiti dell'IA, dovrebbero essere accompagnate da test unitari rigorosi per evitare che un cambio nel formato di un documento legale mandi in crash l'estrazione.

### 🔍 Servizio LLM (`llmService.ts`)
Il sistema di prompt è ben strutturato, ma la validazione della risposta JSON dell'LLM potrebbe essere più robusta. Attualmente, se l'LLM restituisce un JSON parzialmente malformato, l'intero chunk viene scartato.

---

## 4. Best Practices di Sviluppo (Electron)

### 🛡️ Sicurezza
L'app è sicura, ma mancano due rifiniture:
1. **CSP (Content Security Policy):** Non è definita nell'HTML. È essenziale per impedire l'esecuzione di script non autorizzati.
2. **External Links:** I link esterni dovrebbero essere aperti esplicitamente con `shell.openExternal` invece di essere semplicemente bloccati.

### 🛠️ Gestione Errori
Molti blocchi `try/catch` loggano l'errore ma restituiscono messaggi generici al Renderer.
- **Miglioramento:** Definire classi di errore personalizzate (es. `OcrError`, `PdfParsingError`) per fornire feedback mirati all'utente (es. "Il PDF è protetto da password" invece di "Errore generico").

---

## 5. Roadmap Suggerita per il Miglioramento

1.  **Fase 1 (Surgical):** Correggere il bug della diagnostica e pulire gli import (`require` vs `import`).
2.  **Fase 2 (Refactoring):** Dividere `nerService.ts` in moduli più piccoli.
3.  **Fase 3 (Performance):** Implementare un Worker Thread per le operazioni pesanti (PDF/BERT).
4.  **Fase 4 (UX):** Migliorare il sistema di download modelli con gestione dei tentativi (retry) e resume.

---

*Documento generato per supportare l'evoluzione di Anonimator verso standard professionali.*
