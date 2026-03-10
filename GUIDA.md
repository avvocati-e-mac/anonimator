# Guida Tecnica — Anonimator

Documentazione tecnica per sviluppatori. Descrive architettura, flussi di dati, logica di anonimizzazione e componenti del software.

**Versione documentata:** 1.2.6
**Stack:** Electron 40 + React 18 + TypeScript (strict mode)
**Scopo:** Pseudonimizzazione locale di documenti legali italiani (PDF, DOCX, ODT, TXT, immagini). Nessuna connessione di rete durante l'elaborazione.

---

## Indice

1. [Architettura generale](#1-architettura-generale)
2. [Separazione dei processi Electron](#2-separazione-dei-processi-electron)
3. [Comunicazione IPC](#3-comunicazione-ipc)
4. [Flusso di elaborazione documento singolo](#4-flusso-di-elaborazione-documento-singolo)
5. [Flusso batch (documenti multipli)](#5-flusso-batch-documenti-multipli)
6. [Parser dei formati](#6-parser-dei-formati)
7. [Motore NER (Named Entity Recognition)](#7-motore-ner-named-entity-recognition)
8. [Session Manager — dizionario pseudonimi](#8-session-manager--dizionario-pseudonimi)
9. [Generatori di output — logica di anonimizzazione](#9-generatori-di-output--logica-di-anonimizzazione)
10. [Interfaccia utente (Renderer)](#10-interfaccia-utente-renderer)
11. [Store Zustand — gestione stato](#11-store-zustand--gestione-stato)
12. [Integrazione LLM locale](#12-integrazione-llm-locale)
13. [Build, CI/CD e distribuzione](#13-build-cicd-e-distribuzione)
14. [Test](#14-test)
15. [Problemi noti e soluzioni](#15-problemi-noti-e-soluzioni)

---

## 1. Architettura generale

L'applicazione segue il modello Electron a tre processi, con una netta separazione tra logica di business (Main), interfaccia (Renderer) e ponte di comunicazione (Preload).

```
┌──────────────────────────────────────────────────────────────────────┐
│                         ELECTRON APP                                 │
│                                                                      │
│  ┌─────────────────────┐    contextBridge    ┌────────────────────┐  │
│  │   MAIN PROCESS      │◄──────────────────►│  RENDERER PROCESS   │  │
│  │   (Node.js)         │    IPC channels     │  (React, sandbox)   │  │
│  │                     │                     │                     │  │
│  │  ┌───────────────┐  │                     │  ┌───────────────┐  │  │
│  │  │ ipcHandlers   │  │    doc:process      │  │ DropZone      │  │  │
│  │  │ nerService    │  │    doc:anonymize     │  │ EntityReview  │  │  │
│  │  │ sessionMgr    │  │    doc:progress      │  │ SuccessScreen │  │  │
│  │  │ parsers/      │  │    batch:anonymize   │  │ BatchReview   │  │  │
│  │  │ outputGens/   │  │    session:reset     │  │ Settings      │  │  │
│  │  │ llmService    │  │    settings:*        │  │ sessionStore  │  │  │
│  │  │ settingsMgr   │  │    llm:*             │  └───────────────┘  │  │
│  │  └───────────────┘  │                     │                     │  │
│  └─────────────────────┘                     └────────────────────┘  │
│                                                                      │
│  ┌─────────────────────┐                                             │
│  │   PRELOAD           │  Espone window.electronAPI                   │
│  │   (contextBridge)   │  al Renderer con API minimale               │
│  └─────────────────────┘                                             │
│                                                                      │
│  ┌─────────────────────┐                                             │
│  │   RISORSE ESTERNE   │  Scaricati al primo avvio in {userData}     │
│  │   (offline dopo dl) │  Modello NER (~65 MB) e OCR ita (~14 MB)    │
│  └─────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────┘

**Principi fondamentali:**

- **Zero rete** durante l'elaborazione. NER, OCR e parsing avvengono interamente offline una volta scaricati i modelli (tramite wizard o Impostazioni).

- **Sicurezza Electron:** il Renderer gira in sandbox (`nodeIntegration: false`, `contextIsolation: true`). Tutta la comunicazione avviene tramite `ipcRenderer.invoke` e canali validati con Zod.
- **Privacy:** nessun contenuto dei documenti viene mai loggato. Solo metadati (formato, dimensione, conteggi, warning).

---

## 2. Separazione dei processi Electron

### Main Process (`src/main/`)

Ha accesso completo a Node.js (file system, moduli nativi). Contiene tutta la logica di business:

| File | Responsabilità |
|------|---------------|
| `index.ts` | Crea la `BrowserWindow`, registra gli handler IPC, blocca la navigazione esterna. Patch `Module._resolveFilename` per Windows (reindirizza `.node` da asar a asar.unpacked). |
| `ipcHandlers.ts` | Hub centralizzato di tutti gli handler IPC. Valida ogni input con Zod prima di processarlo. |
| `services/nerService.ts` | Motore NER ibrido: regex + BERT (Transformers.js) + LLM opzionale. |
| `services/sessionManager.ts` | Dizionario in-memoria degli pseudonimi. Genera e mantiene le corrispondenze originale→pseudonimo. |
| `services/settingsManager.ts` | Configurazione LLM persistente su disco (`{userData}/legalshield-settings.json`). |
| `services/llmService.ts` | Client per LLM locali (Ollama/LM Studio) via endpoint OpenAI-compatibile. |
| `parsers/` | Estrattori di testo per ogni formato (txt, docx, odt, pdf, ocr, markdown). |
| `outputGenerators/` | Generatori di file anonimizzati per ogni formato. |

### Preload (`src/preload/index.ts`)

Espone tramite `contextBridge` l'oggetto `window.electronAPI` con metodi tipizzati. Il Renderer non ha mai accesso diretto a Node.js.

```typescript
window.electronAPI = {
  processDocument(filePath)         // → Promise<DocumentAnalysisResult>
  anonymizeDocument(request)        // → Promise<SaveResult>
  batchAnonymize(requests)          // → Promise<BatchResultItem[]>
  resetSession()                    // → Promise<{status}>
  onProgress(callback)              // → () => void (unsubscribe)
  showInFolder(filePath)            // Apre il file manager
  getPathForFile(file)              // Path assoluto da File drag-drop
  getSettings()                     // → Promise<{llm: LlmConfig}>
  setSettings(settings)             // → Promise<{status}>
  testLlm(config)                   // → Promise<{ok, message}>
  listLlmModels(baseUrl)            // → Promise<{models[]}>
  getDefaultPrompt(lang)            // → Promise<string>
  getAppVersion()                   // → Promise<string>
}
```

### Renderer (`src/renderer/`)

App React sandboxata. Zero accesso a Node.js. Stato gestito con Zustand. Styling con Tailwind CSS.

### Shared (`src/shared/types.ts`)

Interfacce TypeScript condivise tra Main e Renderer: tipi di entità, contratti IPC, configurazione LLM.

---

## 3. Comunicazione IPC

Tutti i canali IPC sono definiti come costanti in `src/shared/types.ts` (mai stringhe hardcoded). Ogni handler nel Main valida l'input con uno schema Zod prima di processarlo.

### Canali e direzione

```
RENDERER → MAIN (invoke/handle)
─────────────────────────────────────────────────────────
doc:process        │ Avvia analisi documento
doc:anonymize      │ Avvia anonimizzazione con entità confermate
batch:anonymize    │ Anonimizzazione batch (array di richieste)
session:reset      │ Resetta dizionario pseudonimi
settings:get       │ Legge configurazione LLM
settings:set       │ Salva configurazione LLM
llm:test           │ Testa connessione LLM
llm:listModels     │ Lista modelli disponibili sul server LLM
llm:getDefaultPrompt│ Ottiene prompt di sistema default (it/en)
app:getVersion     │ Versione app da package.json
shell:showInFolder │ Apre cartella nel file manager
diag:collect       │ Raccoglie diagnostica installazione, copia negli appunti
model:status       │ Verifica presenza modello NER (onnx/model_quantized.onnx)
model:download     │ Avvia download modello da HuggingFace (~65 MB, 4 file)

MAIN → RENDERER (send/on)
─────────────────────────────────────────────────────────
doc:progress              │ Aggiornamento progresso (stage, percent, message)
model:download:progress   │ Progresso download modello (file, percent, done, error?)
```

### Schema di validazione (esempio)

```typescript
// ipcHandlers.ts
const ProcessDocumentSchema = z.object({
  filePath: z.string().min(1).refine(
    (p) => ['.pdf','.docx','.odt','.txt','.md','.png','.jpg','.jpeg']
           .some(ext => p.toLowerCase().endsWith(ext)),
    { message: 'Formato file non supportato' }
  ),
});

const AnonymizeRequestSchema = z.object({
  filePath: z.string().min(1),
  entities: z.array(z.object({
    id: z.string(),
    type: z.string(),
    originalText: z.string(),
    pseudonym: z.string(),
    occurrences: z.number(),
    confirmed: z.boolean(),
  })),
});
```

---

## 4. Flusso di elaborazione documento singolo

Il diagramma seguente mostra la sequenza temporale completa, dal drop del file fino al salvataggio del documento anonimizzato.

```
 UTENTE          RENDERER (React)           PRELOAD              MAIN PROCESS
   │                  │                       │                      │
   │  Drop file       │                       │                      │
   ├─────────────────►│                       │                      │
   │                  │  processDocument()    │                      │
   │                  ├──────────────────────►│  ipc: doc:process    │
   │                  │                       ├─────────────────────►│
   │                  │                       │                      │
   │                  │                       │     ┌────────────────┤
   │                  │                       │     │ 1. Zod validate│
   │                  │                       │     │ 2. detectFormat│
   │                  │                       │     │ 3. extractText │
   │                  │  onProgress(10%)      │     │    (parser)    │
   │                  │◄──────────────────────┤◄────┤ 4. analyzeText │
   │                  │                       │     │    (NER)       │
   │                  │  onProgress(50%)      │     │ 5. enrichEntit │
   │                  │◄──────────────────────┤◄────┤    (session)   │
   │                  │                       │     └────────────────┤
   │                  │  result: entities[]   │                      │
   │                  │◄──────────────────────┤◄─────────────────────┤
   │                  │                       │                      │
   │                  │  → screen: 'review'   │                      │
   │  Vede entità     │                       │                      │
   │◄─────────────────┤                       │                      │
   │                  │                       │                      │
   │  Conferma/edita  │                       │                      │
   │  pseudonimi      │                       │                      │
   ├─────────────────►│                       │                      │
   │                  │                       │                      │
   │  Click "Anonimizza"                      │                      │
   ├─────────────────►│                       │                      │
   │                  │  anonymizeDocument()  │                      │
   │                  ├──────────────────────►│  ipc: doc:anonymize  │
   │                  │                       ├─────────────────────►│
   │                  │                       │     ┌────────────────┤
   │                  │                       │     │ 1. Zod validate│
   │                  │                       │     │ 2. generateOut │
   │                  │                       │     │    (per format)│
   │                  │                       │     │ 3. Salva file  │
   │                  │                       │     │    _anonimizzat│
   │                  │                       │     └────────────────┤
   │                  │  result: outputPath   │                      │
   │                  │◄──────────────────────┤◄─────────────────────┤
   │                  │                       │                      │
   │                  │  → screen: 'success'  │                      │
   │  Vede risultato  │                       │                      │
   │◄─────────────────┤                       │                      │
```

### Dettaglio dell'handler `doc:process`

All'interno di `ipcHandlers.ts`, l'handler esegue questi passi:

1. **Validazione Zod** del `filePath` (estensione consentita)
2. **`detectFormat(filePath)`** → determina il `DocumentFormat` dall'estensione
3. **`extractText(filePath, format)`** → invoca il parser appropriato, restituisce `{text, pageCount, warnings}`
4. **`analyzeText(text, llmConfig)`** → esegue il motore NER ibrido (regex + BERT + LLM opzionale)
5. **`sessionManager.enrichEntities(entities)`** → assegna pseudonimi a ogni entità usando il dizionario di sessione
6. **Risposta** al Renderer con `{fileName, format, pageCount, entities[], warnings[]}`

Durante l'elaborazione, il Main invia eventi `doc:progress` al Renderer con `{stage, percent, message}`. Gli stage sono: `'parsing'`, `'ner'`, `'ocr'`, `'done'`.

### Dettaglio dell'handler `doc:anonymize`

1. **Validazione Zod** di `filePath` e array `entities`
2. **`generateOutput(filePath, format, entities)`** → invoca il generatore specifico per il formato
3. Il generatore produce il file `[nome]_anonimizzato.[ext]` nella stessa cartella dell'originale
4. **Risposta** con `{outputPath, entitiesReplaced}`

---

## 5. Flusso batch (documenti multipli)

Quando l'utente trascina 2+ file, si attiva il flusso batch.

```
 UTENTE          RENDERER                    MAIN PROCESS
   │                  │                          │
   │  Drop N file     │                          │
   ├─────────────────►│                          │
   │                  │                          │
   │                  │  Per ogni file (sequenziale):
   │                  │  processDocument(file_i) │
   │                  ├─────────────────────────►│
   │                  │  result_i / error_i      │
   │                  │◄─────────────────────────┤
   │                  │                          │
   │                  │  Se errore → dialog      │
   │  Retry / Skip    │  "Riprova" o "Salta"     │
   │◄─────────────────┤                          │
   ├─────────────────►│                          │
   │                  │                          │
   │                  │  Dopo tutti i file:       │
   │                  │  mergeEntities(results)   │
   │                  │  (deduplicazione)         │
   │                  │                          │
   │                  │  → screen: 'batch-review' │
   │  Vede entità     │  (entità deduplicate)     │
   │  unificate       │                          │
   │◄─────────────────┤                          │
   │                  │                          │
   │  Conferma e click "Anonimizza N file"       │
   ├─────────────────►│                          │
   │                  │  batchAnonymize(requests) │
   │                  ├─────────────────────────►│
   │                  │                          │
   │                  │  Per ogni file:           │
   │                  │  generateOutput(file_i)   │
   │                  │                          │
   │                  │  results[]               │
   │                  │◄─────────────────────────┤
   │                  │                          │
   │                  │  → screen: 'batch-success'│
   │  Vede risultati  │  (per-file status)        │
   │◄─────────────────┤                          │
   │                  │                          │
   │  "Aggiungi altri"│  resetBatchOnly()         │
   │  (mantiene       │  (dizionario mantenuto)   │
   │   dizionario)    │                          │
   │  oppure          │                          │
   │  "Nuova sessione"│  resetSession() + reset() │
   │  (pulisce tutto) │  (dizionario cancellato)  │
```

### Deduplicazione entità (`entityUtils.ts`)

La funzione `mergeEntities(results: DocumentAnalysisResult[])` unifica le entità trovate nei diversi file:

- Crea una `Map` con chiave `originalText.toLowerCase()`
- Per ogni entità in ogni risultato: se la chiave esiste, incrementa `occurrences` e `fileCount`; altrimenti, aggiunge con `fileCount: 1`
- Restituisce l'array ordinato per `occurrences` decrescente

Questo garantisce che l'utente confermi ogni pseudonimo **una sola volta**, anche se l'entità appare in più file.

### Differenza tra "Aggiungi altri" e "Nuova sessione"

- **Aggiungi altri documenti** (`resetBatchOnly`): torna alla DropZone ma mantiene il dizionario del `sessionManager`. I prossimi documenti useranno gli stessi pseudonimi già assegnati. Utile per lavorare su un fascicolo suddiviso in più file.
- **Nuova sessione** (`resetSession` + `reset`): cancella il dizionario e riparte da zero. I prossimi documenti riceveranno pseudonimi nuovi.

---

## 6. Parser dei formati

Ogni parser trasforma un file in testo piano per il motore NER. L'entry point è `parsers/index.ts`.

### Routing dei formati

```typescript
detectFormat(filePath: string): DocumentFormat
// Mappa estensione → formato:
//   .pdf → 'pdf'   .docx → 'docx'   .odt → 'odt'
//   .txt → 'txt'   .md → 'markdown'
//   .png/.jpg/.jpeg → 'image'

extractText(filePath: string, format: DocumentFormat): Promise<ParseResult>
// ParseResult = { text: string, pageCount: number, warnings: string[] }
```

### 6.1 Parser TXT (`parsers/txtParser.ts`)

Il più semplice. Legge il file come UTF-8; se fallisce (caratteri non validi), riprova con encoding Latin-1. Normalizza i fine riga (`\r\n` → `\n`). Stima le pagine come `ceil(lunghezza / 3000)`.

```typescript
parseTxt(filePath: string): Promise<ParseResult>
```

### 6.2 Parser DOCX (`parsers/docxParser.ts`)

Un file DOCX è un archivio ZIP contenente XML. Il parser:

1. Apre l'archivio con `adm-zip`
2. Estrae `word/document.xml`
3. Parsa l'XML con `fast-xml-parser` (preservando attributi)
4. Naviga la struttura: `w:document → w:body → w:p (paragrafi) → w:r (run) → w:t (testo)`
5. Concatena i run di ogni paragrafo, separando i paragrafi con `\n`
6. Gestisce tabelle ricorsivamente: `w:tbl → w:tr → w:tc` (celle contengono paragrafi)

```
┌─ DOCX (ZIP) ─────────────────────────────────────┐
│                                                    │
│  word/document.xml                                 │
│  ┌─ w:body ─────────────────────────────────────┐  │
│  │                                               │  │
│  │  ┌─ w:p (paragrafo) ─────────────────────┐   │  │
│  │  │  w:r  →  w:t "Il sig. "               │   │  │
│  │  │  w:r  →  w:t "Mario"                  │   │  │
│  │  │  w:r  →  w:t " Rossi è..."            │   │  │
│  │  │  Testo risultante: "Il sig. Mario Rossi│è."│  │
│  │  └───────────────────────────────────────┘   │  │
│  │                                               │  │
│  │  ┌─ w:tbl (tabella) ─────────────────────┐   │  │
│  │  │  w:tr → w:tc → w:p → run → testo      │   │  │
│  │  └───────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

**Nota critica — run-split:** In un DOCX, una singola parola può essere spezzata in più `<w:r>` (per cambi di formattazione, correzioni ortografiche, ecc.). Ad esempio "ROSSI" potrebbe essere `<w:r><w:t>ROS</w:t></w:r><w:r><w:t>SI</w:t></w:r>`. Il parser concatena i run prima di passare il testo al NER, ma il generatore di output deve gestire questa frammentazione durante la sostituzione (vedi sezione 9.2).

### 6.3 Parser ODT (`parsers/odtParser.ts`)

Analogo al DOCX ma con namespace OpenDocument. Apre l'archivio ZIP, estrae `content.xml`, naviga `office:document-content → office:body → office:text`. I paragrafi sono `text:p` e `text:h` (heading), il testo è in `text:span` o direttamente nel nodo.

```typescript
parseOdt(filePath: string): Promise<ParseResult>
```

### 6.4 Parser PDF (`parsers/pdfParser.ts`)

Il parser più complesso. Usa `pdfjs-dist` per estrarre testo e coordinate.

```typescript
parsePdf(filePath: string): Promise<PdfParseResult>

interface PdfParseResult extends ParseResult {
  isScanned: boolean      // true se media < 80 caratteri/pagina
  tokens: TextToken[]     // coordinate di ogni frammento di testo
  pageHeights: number[]   // altezza di ogni pagina (per conversione coordinate)
}

interface TextToken {
  str: string             // testo del frammento
  page: number            // pagina (1-based)
  x: number               // coordinata X (punti PDF)
  y: number               // coordinata Y (origin in basso a sinistra)
  width: number
  height: number
  fontSize: number
}
```

**Algoritmo:**

1. Carica il PDF con `pdfjs-dist` (`isEvalSupported: false` per sicurezza)
2. Per ogni pagina, estrae gli item di testo con coordinate dalla matrice di trasformazione
3. Raggruppa i token in righe logiche per coordinata Y (tolleranza: 3pt)
4. Rileva heading: se la dimensione font è ≥ 1.6× la mediana → `# Heading`; se ≥ 1.3× → `## Subheading`
5. Normalizza lettere spaziate (`L A C O R T E` → `LACORTE`) tramite `normalizeSpacedLetters()`
6. **Rilevamento PDF scansionato:** se la media caratteri/pagina < 80, imposta `isScanned: true` e il flusso principale passa automaticamente al parser OCR

I `TextToken` sono fondamentali per il generatore PDF (sezione 9.4): servono a localizzare le entità nel PDF e posizionare i rettangoli di copertura.

### 6.5 Parser OCR (`parsers/ocrParser.ts`)

Per immagini singole e PDF scansionati. Usa `tesseract.js` con dati di training italiani scaricati.

```typescript
parseImage(filePath: string): Promise<ParseResult>     // immagine singola
parsePdfWithOcr(filePath: string): Promise<ParseResult> // PDF scansionato
```

**Per PDF scansionato:**
1. Per ogni pagina, renderizza in PNG a 150 DPI usando `node-canvas`
2. Esegue OCR sull'immagine PNG
3. Aggrega il testo e la confidenza media
4. Se la confidenza di una pagina è < 60%, aggiunge un warning

**Per immagine singola:**
1. Crea un worker tesseract con lingua 'ita'
2. Carica il tessdata da `app.getAppPath()/resources/tessdata/ita.traineddata`
3. Riconosce il testo e restituisce `{text, confidence}`

### 6.6 Parser Markdown (`parsers/markdownParser.ts`)

Legge il file e rimuove la sintassi Markdown (heading, bold, italic, code blocks, link, immagini, blockquote, liste) tramite regex, producendo testo piano per il NER.

```typescript
parseMarkdown(filePath: string): Promise<ParseResult>
```

---

## 7. Motore NER (Named Entity Recognition)

File: `src/main/services/nerService.ts`

Il cuore dell'applicazione. Implementa un approccio **ibrido a tre livelli** per massimizzare il riconoscimento di entità nei documenti legali italiani.

```typescript
analyzeText(text: string, llmConfig?: LlmConfig): Promise<NerAnalysisResult>

interface NerAnalysisResult {
  entities: DetectedEntity[]
  nerUsed: boolean       // il modello BERT è stato utilizzato con successo
  llmUsed: boolean       // un LLM locale ha contribuito
  warnings: string[]
}
```

### Panoramica dei tre livelli

```
                          TESTO ESTRATTO
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌─────────────┐  ┌──────────────┐  ┌────────────┐
     │  LIVELLO 1  │  │  LIVELLO 2   │  │ LIVELLO 3  │
     │  Regex      │  │  BERT (ONNX) │  │ LLM locale │
     │  (sempre)   │  │  (se modello │  │ (opzionale)│
     │             │  │   presente)  │  │            │
     └──────┬──────┘  └──────┬───────┘  └─────┬──────┘
            │                │                 │
            └────────────────┼─────────────────┘
                             │
                     DEDUPLICAZIONE
                     FILTRAGGIO
                     PULIZIA
                             │
                             ▼
                    DetectedEntity[]
```

### 7.1 Livello 1 — Pattern Regex

Eseguito sempre, indipendentemente dalla disponibilità del modello BERT. Rileva dati strutturati italiani e pattern tipici dei documenti legali.

#### Pattern per dati strutturati (Step 1)

| Tipo | Pattern | Esempio |
|------|---------|---------|
| `CODICE_FISCALE` | `/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi` | `RSSMRA80A01H501U` |
| `PARTITA_IVA` | `/\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi` | `P.IVA 01234567890` |
| `IBAN` | `/\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi` | `IT60X0542811101000000123456` |
| `EMAIL` | `/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi` | `mario.rossi@pec.it` |
| `TELEFONO` | `/\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}\|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g` | `+39 06 12345678` |

Questi pattern usano `\b` (word boundary) anziché `^`/`$` perché il matching avviene su testo estratto da paragrafi, non su righe isolate.

#### Pattern per intestazioni di sentenze (Step 0)

Riconosce le formule tipiche delle intestazioni giudiziarie italiane dove i nomi dei magistrati appaiono in maiuscolo seguiti dal ruolo:

```
Dott. MARIO BERTUZZI                    - Presidente -
Dott.ssa ANNA D'ANGIOLINO               - Consigliere -
```

Il pattern rileva titoli (`Dott.`, `Avv.`, `Prof.`, `Ing.`), nomi in maiuscolo (anche con apostrofi come `D'ANGIOLINO`), e ruoli giudiziari (`Presidente`, `Consigliere`, `Giudice`, ecc.).

#### Pattern per strutture legali (Step 0b)

11 pattern specifici per documenti legali italiani:

| ID | Pattern | Tipo rilevato | Esempio |
|----|---------|---------------|---------|
| A1 | `PROCESSO_PARTE_PATTERN` | PERSONA | `ricorrente: MARIO ROSSI` |
| A2 | `DIFENSORE_PATTERN` | PERSONA | `difeso dall'avv. ANNA BIANCHI` |
| A3 | `ALLCAPS_NAME_PATTERN` | PERSONA | `COLOMBO LUIGI` (su riga propria) |
| B1 | `DATA_NASCITA_PATTERN` | DATA_NASCITA | `nato a Roma il 15/03/1980` |
| B2 | `INDIRIZZO_PATTERN` | INDIRIZZO | `residente in Via Roma 123, 00100 Roma` |
| B3 | `NUMERO_DOCUMENTO_PATTERN` | NUMERO_DOCUMENTO | `Passaporto n. AB123456` |
| C1 | `POLIZZA_PARTE_PATTERN` | PERSONA | `Contraente: LUIGI ROSSI` |
| C2 | `CONTRATTO_PARTE_PATTERN` | PERSONA | `tra MARIO ROSSI, nato a...` |
| C3 | `PERIZIA_SOGGETTO_PATTERN` | PERSONA | `Paziente: ANNA BIANCHI` |
| D1 | `AVV_LISTA_PATTERN` | PERSONA | `avvocati MARIO ROSSI, ANNA BIANCHI` |
| D2 | `PKI_FIRMA_PATTERN` | PERSONA | `Firmato Da: COLOMBO LUIGI Emesso Da:` |

### 7.2 Livello 2 — Modello BERT (Transformers.js + ONNX)

Usa il modello `DeepMount00/Italian_NER_XXL_v2` quantizzato in ONNX, eseguito localmente tramite `@huggingface/transformers`.

**Caricamento (lazy, una sola volta):**

```typescript
// Import dinamico per non rallentare lo startup
const { pipeline } = await import('@huggingface/transformers');

// Cerca il modello in due percorsi:
// - Produzione: process.resourcesPath/resources/models/italian-ner-xxl-v2
// - Sviluppo: __dirname/../../resources/models/italian-ner-xxl-v2

const pipe = await pipeline('token-classification', modelPath, {
  local_files_only: true,            // MAI download da rete
  model_file_name: 'model_quantized', // ONNX quantizzato (~65 MB)
  session_options: {
    intraOpNumThreads: Math.min(4, os.cpus().length),
    interOpNumThreads: 1
  }
});
```

Se il modello non è trovato o onnxruntime fallisce, il sistema prosegue con solo regex (graceful degradation).

**Elaborazione del testo:**

1. **Chunking:** il testo viene diviso in chunk da ~400 parole, cercando di spezzare ai confini di frase (`.`, `!`, `?`)
2. **Batch processing:** i chunk vengono processati in batch da 4, con `Promise.all`
3. **Aggregazione token BIO:** la funzione `aggregateBioTokens()` combina token consecutivi con lo stesso label BIO:
   - Token con prefisso `B-` iniziano una nuova entità
   - Token con prefisso `I-` continuano l'entità corrente
   - Token che iniziano con `##` sono continuazioni di subword (WordPiece)
   - Limite: massimo 5 parole per entità
   - Gestione apostrofi: `D' + ANGIOLINO → D'ANGIOLINO` (senza spazio)

**Mapping label → tipo entità:**

Il modello produce 52 categorie. Quelle mappate sono:

| Label BERT | Tipo applicativo |
|------------|-----------------|
| `PER` | `PERSONA` |
| `ORG` | `ORGANIZZAZIONE` |
| `LOC` | `LUOGO` |

**Soglie di confidenza:**

| Tipo | Soglia minima |
|------|--------------|
| PERSONA | 0.50 |
| ORGANIZZAZIONE | 0.60 |
| LUOGO | 0.65 |

Token sotto soglia vengono scartati.

**Filtri di rumore:**

- **Istituzioni pubbliche:** le organizzazioni che iniziano con "tribunale", "corte", "ministero", "agenzia", "inps", ecc. vengono escluse (non sono dati personali)
- **Rumore PKI:** frammenti brevi da firme digitali (`NG`, `CA`, `G3`, `OU`, ecc.) vengono esclusi
- **Blocklist maiuscole:** acronimi comuni (`SPA`, `SRL`, `INPS`, `ISTAT`, ecc.) vengono esclusi

### 7.3 Livello 3 — LLM locale (opzionale)

Se l'utente ha configurato un LLM locale (Ollama o LM Studio), il sistema lo usa come terzo livello di riconoscimento.

**Funzionamento:**

1. Il testo viene diviso in chunk da `chunkSize` caratteri (default 3000), rispettando i confini `\n\n` (salti di pagina)
2. Ogni chunk viene inviato all'LLM con un prompt di sistema specifico (italiano o inglese) che chiede di estrarre **solo nomi di persone fisiche private e aziende private**
3. I chunk vengono processati in batch da `parallelRequests` (1-4)
4. L'LLM risponde con un array JSON `[{original, replacement}, ...]`
5. La risposta viene validata con `isValidReplacement()` (filtra stopword, date, pattern legali, frasi troppo lunghe)
6. Gli pseudonimi suggeriti dall'LLM vengono registrati nel `sessionManager`

**Differenza rispetto ai livelli 1 e 2:** l'LLM è l'unico livello che **suggerisce anche lo pseudonimo** (initiali puntate), mentre regex e BERT trovano solo il testo originale e delegano la generazione dello pseudonimo al `sessionManager`.

### 7.4 Deduplicazione e pulizia finale

Dopo aver raccolto le entità da tutti e tre i livelli:

**Deduplicazione nomi (Step 3b):**

La funzione `isSameName(a, b)` confronta coppie di PERSONA e ORGANIZZAZIONE:
- Converte in token lowercase, rimuove stopword italiane
- Richiede almeno 2 token significativi per entrambi
- Verifica se l'insieme di token più piccolo è sottoinsieme del più grande
- Esempio: `"MARIO BERTUZZI"` e `"Dott. Mario Bertuzzi - Presidente"` → stesso nome
- Mantiene la versione più breve (testo più pulito) o la più frequente

**Espansione varianti (Step 4):**

Per ogni entità BERT, se esiste una variante in maiuscolo nel testo, la aggiunge come entità separata con lo stesso pseudonimo. Esempio: se il modello trova "Mario Rossi", controlla se nel testo appare anche "MARIO ROSSI" e in caso affermativo lo aggiunge.

**Pulizia finale (Step 6):**

Due regole per eliminare entità rumorose:
- **Caso A:** un'entità lunga contiene un'entità più corta → rimuove la lunga se la corta appare solo all'interno della lunga
- **Caso B:** un'entità corta (1 token) appare solo dentro entità più lunghe → rimuove la corta se non ha occorrenze autonome significative

**Output finale:** array ordinato per `occurrences` decrescente. Le entità `LUOGO` hanno `confirmed: false` di default (richiedono conferma esplicita dell'utente).

---

## 8. Session Manager — dizionario pseudonimi

File: `src/main/services/sessionManager.ts`

Mantiene in memoria un dizionario bidirezionale `testo originale → pseudonimo`. Garantisce che la stessa entità riceva sempre lo stesso pseudonimo all'interno di una sessione.

### Generazione pseudonimi

```typescript
getOrCreatePseudonym(originalText: string, type: EntityType): string
```

La strategia di generazione dipende dal tipo di entità:

| Tipo | Strategia | Esempio |
|------|-----------|---------|
| `CODICE_FISCALE` | Codice incrementale | `CF_001`, `CF_002` |
| `PARTITA_IVA` | Codice incrementale | `PIVA_001` |
| `IBAN` | Codice incrementale | `IBAN_001` |
| `EMAIL` | Codice incrementale | `EMAIL_001` |
| `TELEFONO` | Codice incrementale | `TEL_001` |
| `DATA_NASCITA` | Codice incrementale | `DATA_001` |
| `INDIRIZZO` | Codice incrementale | `IND_001` |
| `NUMERO_DOCUMENTO` | Codice incrementale | `DOC_001` |
| `PERSONA` | Iniziali puntate | `M. R.` (da "Mario Rossi") |
| `ORGANIZZAZIONE` | Iniziali puntate | `A. S.` (da "Alfa Servizi") |
| `LUOGO` | Iniziali puntate | `R.` (da "Roma") |

**Gestione conflitti iniziali:** se le iniziali `M. R.` sono già assegnate a un'altra persona, il sistema genera `M. R. (2)`, `M. R. (3)`, ecc.

**Fallback numerico:** se le iniziali non sono generabili (testo troppo corto o composto solo da numeri/punteggiatura), il sistema genera `SOGGETTO_001` per PERSONA, `ENTE_001` per ORGANIZZAZIONE, `LUOGO_001` per LUOGO.

### Funzione `toInitials(text)`

```typescript
toInitials(text: string): string | null
// "Mario Rossi"       → "M. R."
// "De Luca"           → "D. L."
// "D'Angiolino"       → "D. A."    (split su apostrofi)
// "123"               → null       (fallback numerico)
```

Rimuove parentesi, numeri, punteggiatura. Divide su spazi/trattini/underscore. Prende la prima lettera di ogni token. Restituisce `null` se il risultato è ≤ 2 caratteri.

### Registrazione pseudonimi LLM

```typescript
registerLlmPseudonym(originalText: string, llmReplacement: string, type: EntityType): string
```

Se il testo è già nel dizionario, restituisce lo pseudonimo esistente (consistenza). Altrimenti registra la sostituzione proposta dall'LLM, gestendo eventuali conflitti come `getOrCreatePseudonym`.

### Arricchimento entità

```typescript
enrichEntities(entities: DetectedEntity[]): DetectedEntity[]
```

Mappa ogni entità chiamando `getOrCreatePseudonym()` per riempire il campo `pseudonym` vuoto. Viene invocata dopo il NER e prima di inviare i risultati al Renderer.

### Ciclo di vita

Il dizionario vive **in RAM** per tutta la durata della sessione. Al completamento di ogni anonimizzazione (singola o batch) viene **salvato automaticamente su disco** in `<userData>/anonimator-session.json`. All'avvio successivo l'utente può ripristinarlo tramite il pannello "Sessione precedente" in DropZone.

### Persistenza su disco

```typescript
saveToDisk(filePath: string): void        // serializza dictionary + counters
loadFromDisk(filePath: string): DetectedEntity[] | null  // carica e restituisce entità ricostruite
hasSavedSession(filePath: string): boolean
deleteSavedSession(filePath: string): void
```

**Formato file** (`anonimator-session.json`):
```json
{
  "version": 1,
  "savedAt": "2026-03-08T10:00:00.000Z",
  "dictionary": [["mario rossi", {"pseudonym": "M. R.", "type": "PERSONA"}], ...],
  "counters": [["CODICE_FISCALE", 2], ...]
}
```

> ⚠️ Il file contiene dati personali in chiaro (testi originali → pseudonimi). Eliminarlo quando non serve più tramite il pulsante "Elimina" in DropZone.

### Importazione dizionario esterno

```typescript
importEntries(entries: EntityDictionaryFile['entries']): void
```

Popola il dizionario con entries esportate da una sessione precedente (o da un altro documento). Il pseudonimo importato ha priorità assoluta su quello che il NER avrebbe generato. I contatori vengono ricalcolati automaticamente per evitare collisioni.

### Aggiunta manuale entità

L'handler IPC `entity:add` chiama `getOrCreatePseudonym()` con il testo e il tipo forniti dall'utente. Il pseudonimo risultante segue le stesse regole della generazione automatica (iniziali per PERSONA/ORG/LUOGO, codice numerico per strutturati).

---

## 9. Generatori di output — logica di anonimizzazione

Qui avviene la sostituzione effettiva del testo nei documenti. Ogni formato ha una strategia diversa a causa della diversa struttura interna dei file.

Entry point: `outputGenerators/index.ts`

```typescript
generateOutput(filePath: string, format: DocumentFormat, entities: DetectedEntity[]): Promise<SaveResult>
// SaveResult = { outputPath: string, entitiesReplaced: number }
```

Il file di output viene salvato nella stessa cartella dell'originale con suffisso `_anonimizzato`.

### 9.1 Strategia TXT e Markdown — sostituzione diretta

File: `outputGenerators/txtGenerator.ts`, `outputGenerators/markdownGenerator.ts`

La strategia più semplice. Il testo è una stringa lineare senza formattazione.

```typescript
replaceEntities(text: string, entities: DetectedEntity[]): { text: string, count: number }
```

**Algoritmo:**

1. Filtra solo le entità con `confirmed: true`
2. Ordina per lunghezza del `originalText` decrescente (le entità più lunghe vengono sostituite prima, evitando che una sostituzione parziale alteri un'entità più lunga)
3. Per ogni entità:
   - Normalizza le virgolette tipografiche (`"` `"` → `"`)
   - Escape dei metacaratteri regex nel testo originale
   - Crea una regex case-insensitive: `new RegExp(escaped, 'gi')`
   - Esegue `text.replace(regex, entity.pseudonym)`
4. Restituisce il testo modificato e il conteggio delle sostituzioni

**Perché l'ordine per lunghezza è importante:** se il testo contiene "Mario Rossi" e "Mario", sostituire prima "Mario" trasformerebbe "Mario Rossi" in "M. R. Rossi", rendendo impossibile trovare "Mario Rossi" per la sostituzione successiva. Sostituendo prima "Mario Rossi" (più lungo), il problema non si pone.

Il generatore Markdown riusa la stessa funzione `replaceEntities()` del TXT — la sintassi Markdown non viene alterata.

### 9.2 Strategia DOCX — sostituzione nel XML con gestione run-split

File: `outputGenerators/docxGenerator.ts`

I file DOCX sono archivi ZIP con XML interno. La sfida principale è che il testo di un'entità può essere **frammentato su più `<w:r>` (run)** all'interno di un paragrafo `<w:p>`.

**Esempio di run-split:**

```xml
<w:p>
  <w:r><w:rPr><w:b/></w:rPr><w:t>MAR</w:t></w:r>
  <w:r><w:t>IO ROSSI</w:t></w:r>
</w:p>
```

Qui "MARIO ROSSI" è spezzato in due run (`MAR` + `IO ROSSI`), magari perché Word ha applicato il grassetto solo alla prima parte.

**Algoritmo di sostituzione per paragrafo:**

```
Per ogni <w:p> nel documento XML:

  1. ESTRAI tutti i segmenti <w:t> con le loro posizioni nel testo concatenato

     Segmento 0: "MAR"       offset 0, length 3
     Segmento 1: "IO ROSSI"  offset 3, length 8
     Testo concatenato: "MARIO ROSSI"

  2. CERCA tutte le occorrenze delle entità nel testo concatenato

     Match: "MARIO ROSSI" a posizione 0, lunghezza 11

  3. ORDINA le sostituzioni per posizione DECRESCENTE
     (modificando da destra a sinistra, gli offset precedenti restano validi)

  4. Per ogni sostituzione, IDENTIFICA i segmenti coinvolti:
     - Segmento 0 (offset 0-2): coinvolto
     - Segmento 1 (offset 3-10): coinvolto

  5. MODIFICA i segmenti in ordine inverso:
     - Ultimo segmento (1): svuota la porzione coinvolta → "IO ROSSI" diventa ""
     - Primo segmento (0): sostituisci con lo pseudonimo → "MAR" diventa "M. R."

  6. APPLICA le modifiche all'XML cercando il tag <w:t> esatto
     con tracking dell'indice di occorrenza per evitare duplicati
```

**Risultato XML:**

```xml
<w:p>
  <w:r><w:rPr><w:b/></w:rPr><w:t>M. R.</w:t></w:r>
  <w:r><w:t></w:t></w:r>
</w:p>
```

**Funzioni helper:**

- `extractTextSegments(paragraphXml)` — trova tutti i `<w:t>` con offset nel testo concatenato
- `findReplacements(concatenatedText, entities)` — trova tutte le occorrenze con regex case-insensitive
- `processSingleParagraph(paragraphXml, entities)` — applica le sostituzioni a un paragrafo
- `processParagraphs(documentXml, entities)` — trova tutti i `<w:p>` nel documento con regex e processa ciascuno
- `normalizeQuotes(text)` — converte virgolette tipografiche in ASCII
- `escapeXml(text)` / `unescapeXml(text)` — encoding/decoding delle entità XML (`&amp;`, `&lt;`, ecc.)

### 9.3 Strategia ODT — sostituzione nel XML con gestione span

File: `outputGenerators/odtGenerator.ts`

Molto simile a DOCX, ma con la struttura XML di OpenDocument. Il testo può essere in `<text:span>` o direttamente nel nodo padre.

**Differenze dal DOCX:**

- I segmenti possono essere di due tipi: span (`<text:span style-name="...">TESTO</text:span>`) o testo diretto (tra tag)
- La sostituzione nel XML deve gestire entrambi i tipi di segmento con regex diverse
- Per gli span: cerca il tag completo `<text:span...>TESTO</text:span>`
- Per il testo diretto: cerca il testo tra i tag adiacenti

### 9.4 Strategia PDF — redazione a due fasi

File: `outputGenerators/pdfGenerator.ts`

La strategia più complessa. I PDF non hanno una struttura "paragrafo → testo" modificabile come XML. Il testo è posizionato con coordinate assolute.

**Fase 1 — Redazione con MuPDF:**

MuPDF è una libreria C per la manipolazione PDF, usata tramite binding Node.js. Questa fase rimuove il testo originale.

```
Per ogni pagina del PDF:
  Per ogni entità confermata:
    1. page.search(entity.originalText) → array di quad (regioni di hit)
    2. Per ogni quad trovato:
       a. Calcola il bounding box [x0, y0, x1, y1]
       b. Crea un'annotazione di tipo 'Redact'
       c. Imposta il rettangolo dell'annotazione
       d. Applica la redazione (rimuove il testo sottostante)
       e. Registra le coordinate per la Fase 2
```

La redazione di MuPDF **rimuove fisicamente** i glifi dal PDF — il testo originale non è più presente nel file, nemmeno come layer nascosto.

**Fase 2 — Overlay con pdf-lib:**

Dopo la redazione, pdf-lib aggiunge i rettangoli colorati e il testo dello pseudonimo.

```
Per ogni box di redazione registrato nella Fase 1:
  1. Converti coordinate MuPDF (Y=0 in alto) → pdf-lib (Y=0 in basso):
     pdfY = pageHeight - box.y1

  2. Disegna rettangolo grigio chiaro:
     page.drawRectangle({
       x: box.x0, y: pdfY,
       width: box.x1 - box.x0,
       height: box.y1 - box.y0,
       color: rgb(0.92, 0.92, 0.92)  // grigio chiaro
     })

  3. Calcola dimensione font (proporzionale all'altezza del box):
     fontSize = clamp(altezza × 0.75, min: 5pt, max: 10pt)

  4. Centra e disegna lo pseudonimo:
     textWidth = font.widthOfTextAtSize(pseudonym, fontSize)
     textX = box.x0 + (width - textWidth) / 2
     textY = pdfY + (height - fontSize) / 2
     page.drawText(pseudonym, {
       x: textX, y: textY,
       size: fontSize,
       color: rgb(0.2, 0.2, 0.2)  // grigio scuro
     })
```

**Confronto visivo prima/dopo:**

```
PRIMA:  "Il sig. Mario Rossi, residente in Via Roma 15..."
DOPO:   "Il sig. [███M. R.███], residente in [████IND_001████]..."
                  ▲ grigio chiaro        ▲ grigio chiaro
```

Il font usato è Helvetica (Standard PDF, non richiede embedding di font aggiuntivi).

### 9.5 Riepilogo strategie per formato

```
┌──────────┬─────────────────────────────────────────────────────────┐
│ FORMATO  │ STRATEGIA DI SOSTITUZIONE                               │
├──────────┼─────────────────────────────────────────────────────────┤
│ TXT      │ Regex replace globale sulla stringa di testo.           │
│ Markdown │ Uguale a TXT (preserva la sintassi Markdown).           │
│          │                                                         │
│ DOCX     │ Sostituzione nel XML di word/document.xml.              │
│          │ Gestisce il run-split: una parola può essere spezzata   │
│          │ in più <w:r>. Lavora per paragrafo, sostituisce da      │
│          │ destra a sinistra per mantenere gli offset.              │
│          │                                                         │
│ ODT      │ Come DOCX ma con namespace OpenDocument.                │
│          │ Gestisce <text:span> e testo diretto.                   │
│          │                                                         │
│ PDF      │ Due fasi:                                               │
│          │ 1) MuPDF: cerca il testo, crea annotazioni Redact,      │
│          │    rimuove i glifi dal PDF (redazione irreversibile).    │
│          │ 2) pdf-lib: sovrappone rettangoli grigi con lo          │
│          │    pseudonimo centrato in Helvetica.                     │
│          │                                                         │
│ Immagini │ Non supportata la generazione output (solo analisi).    │
└──────────┴─────────────────────────────────────────────────────────┘
```

---

## 10. Interfaccia utente (Renderer)

L'app React è strutturata come una macchina a stati con 7 schermate, gestite dal campo `screen` nello store Zustand.

### Navigazione tra schermate

```
                           FLUSSO SINGOLO
                    ┌─────────────────────────┐
                    │                         │
                    ▼                         │
              ┌──────────┐                    │
              │ dropzone │◄───────────────────┘
              └────┬─────┘                reset()
                   │ drop 1 file
                   ▼
             ┌────────────┐
             │ processing │ (analisi NER)
             └─────┬──────┘
                   │ completata
                   ▼
             ┌──────────┐
             │  review   │ (conferma entità)
             └─────┬─────┘
                   │ click "Anonimizza"
                   ▼
             ┌────────────┐
             │ processing │ (generazione output)
             └─────┬──────┘
                   │ completata
                   ▼
             ┌──────────┐
             │ success   │ → "Altro documento" → reset() → dropzone
             └──────────┘


                           FLUSSO BATCH
              ┌──────────┐
              │ dropzone │
              └────┬─────┘
                   │ drop 2+ file
                   ▼
         ┌──────────────────┐
         │ batch-processing │ (analisi sequenziale)
         └────────┬─────────┘
                  │ tutte completate
                  ▼
         ┌──────────────┐
         │ batch-review  │ (entità deduplicate)
         └───────┬───────┘
                 │ click "Anonimizza N file"
                 ▼
         ┌───────────────────┐
         │  batch-success    │
         └───┬──────────┬────┘
             │          │
             ▼          ▼
    "Aggiungi altri"  "Nuova sessione"
    resetBatchOnly()   resetSession()
    (mantiene dict)    (pulisce tutto)
```

### Componenti principali

#### `DropZone.tsx`

- Accetta file tramite drag-and-drop (`react-dropzone`)
- Intercetta l'evento `drop` nativo (in fase di capture) per estrarre i path assoluti con `webUtils.getPathForFile()` prima che react-dropzone cloni gli oggetti `File`
- Mostra: versione app, badge privacy ("Nessun dato inviato in rete"), toggle tema, bottone impostazioni
- Se 1 file → flusso singolo; se 2+ file → flusso batch
- **Pannello "Importa dizionario entità"** (sempre visibile): apre dialog file JSON → carica entità → va direttamente a EntityReview senza analisi NER
- **Pannello "Sessione precedente"**:
  - Se `hasSavedSession = true`: mostra path file, pulsante "Elimina" (con conferma) + "Carica"
  - Se `hasSavedSession = false`: testo "Nessuna sessione precedente salvata", pulsante "Carica" disabilitato
  - "Carica" → `loadSession()` IPC → EntityReview con `filePath = null` (warn: "Trascina un documento per anonimizzare")
  - "Elimina" → `deleteSession()` IPC → `hasSavedSession = false`
- Nota privacy: "Il file sessione contiene dati personali in chiaro. Elimina la sessione quando non serve più."

#### `ProcessingScreen.tsx`

- Barra di progresso animata (0-100%)
- Mostra il nome del file in elaborazione
- Pulsante "Annulla" → `reset()`

#### `EntityReview.tsx`

- Lista scrollabile di entità rilevate
- Per ogni entità (`EntityRow`):
  - Checkbox per confermare/escludere dall'anonimizzazione
  - **Badge tipo cliccabile**: click → `<select>` dropdown inline con tutti gli 11 tipi — il badge si aggiorna subito
  - **Testo originale cliccabile**: click (o comparsa icona matita in hover) → input inline editabile. `Enter`/blur per confermare, `Esc` per annullare. `title="Modifica il testo da cercare nel documento"`. Aggiorna `originalText` nello store — il generator usa il testo corretto
  - Pseudonimo editabile (click → input inline, Enter/blur per confermare, Esc per annullare)
  - Conteggio occorrenze (×N se > 1)
- Sezione warning collassabile (se il parser ha generato avvertimenti)
- **Mini drop zone** (visibile solo quando `filePath === null`, cioè sessione ripristinata o dizionario importato da DropZone):
  - Appare sopra la lista entità con il testo "Trascina il documento da anonimizzare, oppure clicca per selezionarlo"
  - Supporta drag & drop nativo Electron tramite `nativeDropPathsRef` (stesso pattern di `DropZone.tsx`)
  - Al drop: avvia `processDocument()`, mostra "Analisi in corso...", mergia le entità NER rilevate con quelle importate (`setFilePathAndMerge`)
  - La mini drop zone scompare automaticamente quando `filePath` viene settato
  - Il pulsante "Anonimizza" si abilita automaticamente dopo l'analisi
- Footer fisso: "Annulla" + "Aggiungi" + "Esporta" + "Importa" + "Anonimizza N entità"
  - "Anonimizza" disabilitato se nessuna entità confermata **o** se `filePath === null` (sessione senza documento)
  - "Aggiungi": apre `AddEntityModal` → `entity:add` IPC → pseudonimo generato automaticamente
  - "Esporta": `entity:export` IPC → dialog salvataggio → file `dizionario-entita.json`
  - "Importa": `entity:import` IPC → dialog apertura → merge nel dizionario (importato vince)
- Al click su "Anonimizza": transizione a processing → `anonymizeDocument()` → success

#### `SuccessScreen.tsx`

- Checkmark verde, conteggio entità sostituite
- Nome file originale e path del file anonimizzato
- "Mostra nella cartella" → `showInFolder()`
- "Anonimizza un altro documento" → `reset()`

#### `BatchProcessingScreen.tsx`

- Sidebar sinistra: lista file con icone di stato (orologio/spinner/check/X)
- Area principale: progresso del file corrente + progresso globale
- Dialog errore per-file: "Riprova" o "Salta"

#### `BatchReview.tsx`

- Come EntityReview ma con entità deduplicate da più file
- Badge aggiuntivo "×N file" se un'entità appare in più documenti
- Footer: stessi pulsanti "Aggiungi" / "Esporta" / "Importa" di EntityReview
- "Anonimizza N file" → filtra entità per file → `batchAnonymize()`

#### `BatchSuccessScreen.tsx`

- Risultati per-file (successo/errore)
- Conteggio totale entità sostituite
- "Mostra cartella" → `showInFolder()` del primo file riuscito
- "Aggiungi altri documenti" → `resetBatchOnly()`
- "Nuova sessione" → `resetSession()` + `reset()`

#### `SettingsScreen.tsx`

Configurazione dell'integrazione LLM locale e strumenti di supporto. Sezioni:
1. Toggle abilitazione LLM
2. Selezione software (Ollama / LM Studio) → imposta URL base
3. Hostname/IP del server
4. Selezione modello (lista suggerita o dropdown dal server)
5. Impostazioni avanzate (collassabili): maxTokens, timeout, parallelRequests, lingua prompt, chunkSize, prompt personalizzato
6. Test connessione → `testLlm()`
8. **Sezione Modello NER**: verifica al mount se `onnx/model_quantized.onnx` è presente (`getModelStatus()` IPC). Se presente: badge verde. Se assente: badge arancione + pulsante "Scarica modello (~65 MB)" → `downloadModel()` IPC → progress bar con file corrente e percentuale globale. Al termine: badge verde + messaggio "Riavvia l'app". La pipeline NER viene resettata automaticamente (`resetNerPipeline()`) senza riavviare il processo.
8. **Sezione Diagnostica**: pulsante "Copia diagnostica" → `collectDiagnostics()` IPC → raccoglie versione/platform/arch, verifica modello NER + ORT binding + detect-libc, prende ultime 100 righe del log, copia tutto negli appunti. Feedback visivo "Copiato!" per 3 secondi.
9. Salva/Annulla

#### `ErrorOverlay.tsx`

Overlay modale fisso (`z-50`) che appare sopra qualsiasi schermata quando `error` è non-null nello store. Mostra il messaggio di errore con pulsante "Chiudi".

---

## 11. Store Zustand — gestione stato

File: `src/renderer/src/store/sessionStore.ts`

Store globale con Zustand (nessun Provider React necessario). Tutte le azioni sono sincrone tranne le chiamate IPC (gestite nei componenti).

### Stato

```typescript
{
  // Navigazione
  screen: AppScreen                    // 'dropzone' | 'processing' | 'review' | ...

  // Flusso singolo
  filePath: string | null              // Path del file in elaborazione
  analysisResult: DocumentAnalysisResult | null
  progressPercent: number              // 0-100
  progressMessage: string
  entities: DetectedEntity[]           // Entità con pseudonimi editabili
  successInfo: SuccessInfo | null      // {outputPath, entitiesReplaced, fileName}

  // Flusso batch
  batchFiles: BatchFileItem[]          // Lista file con stato
  batchCurrentFileIndex: number
  mergedEntities: MergedEntity[]       // Entità deduplicate
  batchResults: BatchResultItem[]      // Risultati finali

  // Errore globale
  error: string | null
}
```

### Azioni principali

| Azione | Effetto |
|--------|---------|
| `setScreen(screen)` | Cambia la schermata corrente |
| `setFilePath(path)` | Salva il path del file |
| `setAnalysisResult(result)` | Salva il risultato dell'analisi, popola `entities` |
| `setProgress(percent, message)` | Aggiorna barra di progresso |
| `toggleEntityConfirmed(id)` | Inverte `confirmed` dell'entità con quell'ID |
| `updateEntityPseudonym(id, pseudonym)` | Aggiorna lo pseudonimo editato dall'utente |
| `addEntity(entity)` | Aggiunge un'entità singola alla lista (inserimento manuale) |
| `addMergedEntity(entity)` | Aggiunge un'entità MergedEntity alla lista batch |
| `importEntitiesToSingle(imported)` | Merge lista importata in `entities` (importato vince) |
| `importEntitiesToBatch(imported)` | Merge lista importata in `mergedEntities` (importato vince) |
| `setFilePathAndMerge(filePath, newEntities)` | Setta `filePath` e mergia `newEntities` in `entities` (esistenti vince su nuove) — usato dalla mini drop zone in EntityReview |
| `reset()` | Ripristina tutto allo stato iniziale |
| `resetBatchOnly()` | Torna a dropzone, mantiene dizionario nel Main |

---

## 12. Integrazione LLM locale

File: `src/main/services/llmService.ts`

Supporta qualsiasi server locale con endpoint compatibile OpenAI (`/v1/chat/completions`). Testato con Ollama e LM Studio.

### Endpoint utilizzati

```
POST {baseUrl}/chat/completions    →  Riconoscimento entità
GET  {baseUrl}/models              →  Lista modelli disponibili
```

### Prompt di sistema

Il prompt (disponibile in italiano e inglese) chiede all'LLM di:
- Estrarre **solo** persone fisiche private e aziende private
- Restituire un array JSON `[{original, replacement}, ...]`
- Usare iniziali puntate per le persone: `"Mario Rossi" → "M. R."`
- Usare iniziale per le aziende: `"Alfa S.r.l." → "A. S.r.l."`
- **Escludere:** istituzioni pubbliche, tribunali, leggi, date, frasi lunghe (4+ parole), metadati di firma digitale

### Validazione risposta

La funzione `parseResponse(content)` gestisce le risposte LLM:
1. Rimuove eventuali code fence Markdown (` ```json ... ``` `)
2. Estrae il primo array JSON trovato nella risposta
3. Filtra con `isValidReplacement()`:
   - Non è una stopword italiana
   - Almeno 3 caratteri
   - Non inizia con stopword
   - Non contiene pattern di date o riferimenti legali
   - Massimo 6 parole

### Configurazione

```typescript
interface LlmConfig {
  enabled: boolean              // Abilitato/disabilitato
  baseUrl: string               // "http://localhost:11434/v1" (Ollama default)
  model: string                 // Nome modello (es. "llama3.2", "mistral")
  maxTokens: number             // 256–32768
  timeoutMs: number             // 5000–600000 ms
  parallelRequests: number      // 1–4 chunk in parallelo
  customPrompt?: string         // Prompt personalizzato (sovrascrive il default)
  promptLanguage: 'it' | 'en'   // Lingua del prompt di sistema
  chunkSize: number             // 1000–8000 caratteri per chunk
}
```

Persistita su disco in `{userData}/legalshield-settings.json` tramite `settingsManager`.

---

## 13. Build, CI/CD e distribuzione

### Script di build

```bash
npm start              # Dev mode (electron-vite dev, hot reload)
npm run ui:dev         # Solo renderer Vite (senza Electron)
npm run ui:build       # Build del renderer
npm run typecheck      # Verifica TypeScript
npm test               # Vitest unit test
npm run build:electron # Pacchettizzazione completa
```

### Risorse esterne (modelli AI)

Le risorse offline NON vengono scaricate durante la CI e non sono incluse nel pacchetto di installazione:
- `italian-ner-xxl-v2/onnx/model_quantized.onnx` (~65 MB) — modello NER
- `ita.traineddata` (~14 MB) — dati OCR italiano

Questi file vengono scaricati dall'app al primo avvio (o tramite le Impostazioni) e salvati nella cartella dati utente (`userData`). Questo permette di mantenere l'installer leggero (~70-90 MB invece di ~170 MB).

### CI/CD (GitHub Actions)

File: `.github/workflows/release.yml`

Trigger: push di un tag `v*` (es. `git tag v1.1.5 && git push origin master --tags`)

```
             git push tag v1.1.5
                     │
        ┌────────────┼────────────┬──────────────┐
        ▼            ▼            ▼              ▼
   build-windows  build-mac    build-mac     build-linux
   (windows-      -arm64       -x64          (ubuntu-
    latest)       (macos-      (macos-        latest)
                   latest)      latest)
        │            │            │              │
        ▼            ▼            ▼              ▼
     .exe          .dmg         .dmg         .AppImage
     x64           arm64        x64           x64
        │            │            │              │
        └────────────┴────────────┴──────────────┘
                          │
                          ▼
                    release job
                    (GitHub Release con
                     changelog da CHANGELOG.md)
```

Ogni job di build:
1. `npm ci` — installazione pulita dipendenze
2. `npx @electron/rebuild --force` — ricompila moduli nativi per l'ABI di Electron
3. `npx electron-vite build` — build renderer + main + preload
4. `npx electron-builder --{platform} --{arch}` — pacchettizzazione

Il job `release` scarica tutti gli artefatti e crea una GitHub Release con i 4 installer allegati.

### Script di diagnostica installazione

File: `scripts/check-install.sh` — script bash standalone per supporto utenti.

Verifica su qualsiasi Mac con Anonimator installato:
- Versione app (da `Info.plist`)
- `model_quantized.onnx` e `tokenizer.json` in `Contents/Resources/resources/models/`
- `onnxruntime_binding.node` per l'architettura corrente (`darwin/arm64` o `darwin/x64`)
- `detect-libc` in `app.asar.unpacked/node_modules/`
- Binari `@img/sharp-darwin-*`
- `ita.traineddata` per OCR
- Ultime 30 righe di `~/Library/Logs/Anonimator/main.log`

Output colorato (✅/❌) con riepilogo finale. Uso remoto:
```bash
bash <(curl -s https://raw.githubusercontent.com/avvocati-e-mac/anonimator/master/scripts/check-install.sh)
```

### Moduli nativi e asarUnpack

Electron impacchetta `node_modules` in un archivio `asar` per efficienza. I moduli con file nativi (`.node`, `.dylib`) devono essere estratti. La configurazione in `electron-builder.config.js`:

```javascript
asarUnpack: [
  'node_modules/mupdf/**/*',
  'node_modules/@huggingface/transformers/**/*',
  'node_modules/onnxruntime-node/**',        // senza /*/ per Windows 10
  'node_modules/onnxruntime-node/dist/**',
  'node_modules/onnxruntime-common/**/*',
  'node_modules/sharp/**/*',
  'node_modules/@img/**/*',
  'node_modules/tesseract.js/**/*',
  'node_modules/tesseract.js-core/**/*',
  'node_modules/semver/**/*'                 // richiesto da sharp/libvips.js su ARM64
]
```

Il pattern `onnxruntime-node/**` (senza `/*` finale) è intenzionale: su Windows 10, `binding.js` deve essere fisicamente nella cartella `asar.unpacked` perché il sistema non fa il fallover automatico da asar per i file `.js` (solo per `.node`).

`semver` è aggiunto ad `asarUnpack` perché `sharp/libvips.js` lo importa su macOS ARM64. Senza questo, il modulo veniva cercato dentro asar ma non trovato, disabilitando il NER BERT.

### Patch `Module._resolveFilename` (Windows + macOS ARM64)

In `src/main/index.ts`, una patch al sistema di risoluzione moduli di Node.js reindirizza i file `.node` e i moduli `onnxruntime`/`sharp`/`@img` da `app.asar` a `app.asar.unpacked`:

```typescript
Module._resolveFilename = function(request, ...rest) {
  const resolved = _origResolve(request, ...rest);
  if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
    if (resolved.endsWith('.node') || resolved.includes('onnxruntime')
        || resolved.includes('/sharp') || resolved.includes('@img')) {
      return resolved.replace('app.asar', 'app.asar.unpacked');
    }
  }
  return resolved;
};
```

**Nota:** `semver` non è nella patch — è estratto correttamente tramite `asarUnpack`. Aggiungere `/semver` alla patch sarebbe sbagliato: reindirizzherebbe verso un path inesistente se semver non è in `asar.unpacked`.

---

## 14. Test

File: `tests/` — Framework: Vitest

| File test | Cosa verifica |
|-----------|---------------|
| `nerRegex.test.ts` | Pattern regex per CF, P.IVA, IBAN, email, telefono + 8 pattern legali italiani |
| `entityUtils.test.ts` | Deduplicazione e merge entità |
| `parsers.test.ts` | Funzionamento dei parser |
| `sessionManager.test.ts` | Generazione pseudonimi, gestione conflitti, reset |
| `pdfParser.test.ts` | Estrazione testo da PDF |

```bash
npm test              # Esegue tutti i test
npm run typecheck     # Verifica tipi (senza eseguire)
```

---

## 15. Problemi noti e soluzioni

### Windows 10 — crash onnxruntime

**Sintomo:** "Impossibile trovare il modulo specificato" all'avvio.

**Causa:** `binding.js` di onnxruntime dentro asar non riesce a caricare i file `.node` nativi. Windows 10 non fa il fallover automatico da asar per file JS.

**Soluzione:** Pattern `asarUnpack` esteso + patch `Module._resolveFilename` + import dinamico del NER.

### macOS — sharp darwin-arm64

**Sintomo:** crash all'avvio con "Could not load the sharp module using the darwin-arm64 runtime".

**Causa:** build x64 da macchina ARM installa binari ARM di sharp.

**Soluzione:** script pre-build che installa i binari sharp per l'architettura target (`--force --no-save`).

### macOS — hdiutil fallisce su iCloud Drive

**Sintomo:** "Risorsa momentaneamente non disponibile" durante la creazione del DMG.

**Soluzione:** fallback automatico a `~/Desktop/` in `scripts/build-mac.sh`.

### PDF scansionati — testo assente

**Sintomo:** il parser PDF non trova testo (< 80 caratteri/pagina).

**Soluzione:** switch automatico a OCR con tesseract.js. Warning all'utente se confidenza < 60%.

### DOCX/ODT — entità spezzate su più run

**Sintomo:** "MARIO ROSSI" non viene trovato perché è diviso in `<w:r>MAR</w:r><w:r>IO ROSSI</w:r>`.

**Soluzione:** il generatore di output lavora sul testo concatenato del paragrafo e gestisce la sostituzione su più segmenti (vedi sezione 9.2).

---

## Appendice — Tipi di entità

| Tipo | Descrizione | Pseudonimo tipico | Rilevamento |
|------|-------------|-------------------|-------------|
| `PERSONA` | Nome e cognome | `M. R.`, `M. R. (2)` | BERT + Regex + LLM |
| `ORGANIZZAZIONE` | Azienda, ente privato | `A. S.`, `ENTE_001` | BERT + LLM |
| `LUOGO` | Città, indirizzo | `R.`, `LUOGO_001` | BERT |
| `CODICE_FISCALE` | Codice fiscale italiano | `CF_001` | Regex |
| `PARTITA_IVA` | Partita IVA | `PIVA_001` | Regex |
| `IBAN` | Conto bancario | `IBAN_001` | Regex |
| `EMAIL` | Indirizzo email | `EMAIL_001` | Regex |
| `TELEFONO` | Numero di telefono | `TEL_001` | Regex |
| `DATA_NASCITA` | Data di nascita | `DATA_001` | Regex legale |
| `INDIRIZZO` | Indirizzo di residenza | `IND_001` | Regex legale |
| `NUMERO_DOCUMENTO` | Carta d'identità, passaporto | `DOC_001` | Regex legale |
