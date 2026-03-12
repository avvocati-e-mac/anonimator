# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Desktop Electron application for **local pseudonymization** of Italian legal documents (PDF, DOCX, ODT, TXT, images). Target users are lawyers with low technical skills. All processing happens **offline** - no network access during document processing to comply with GDPR and professional secrecy requirements.

**Tech Stack:** Electron + React 18 + TypeScript (strict mode)

## Session Memory

Before starting any work, read the latest file in `sessioni/` to understand what was done in previous sessions, which decisions were made, and what the current state of the project is.

After completing significant work, update or create a new session file in `sessioni/` documenting decisions, files changed, and next steps. Session files are named: `sessione_NNN_faseN.md` (e.g. `sessione_001_fase1.md`)

**Template sessione obbligatorio:**
```markdown
# Sessione NNN — [Titolo breve]
**Data:** YYYY-MM-DD
**Versione:** x.y.z

## Obiettivo
## Decisioni prese
## File modificati
## Problemi noti / TODO prossima sessione
```

## Session Startup Checklist

Prima di iniziare qualsiasi lavoro, eseguire questi controlli:

1. [ ] Letto il file più recente in `sessioni/`
2. [ ] Verificato che `npm run typecheck` passi (nessun errore preesistente)
3. [ ] Controllato `git status` (nessun file uncommitted non intenzionale)
4. [ ] Gemini CLI disponibile? `command -v gemini` (opzionale — skip se non presente)

Read-only operations (`cat`, `grep`, `git log`, `git diff`, `git status`, `npm run typecheck`) do **NOT** require user confirmation — execute immediately. Write/delete/commit operations require confirmation only if not part of an already-approved plan.

## AI Agent Roles

### Claude Code (primary)
- Writes/modifies all repo files, runs build/test, controlled refactoring, debugging
- Implements the roadmap phase by phase, stops at end of each phase for user confirmation
- Updates `sessioni/` files after each significant work session

### Gemini CLI (secondary — research + code drafting, does NOT commit files)

Use Gemini CLI for targeted research and isolated code drafting when available.

**Pre-flight check — verificare disponibilità prima di usarlo:**
```bash
if ! command -v gemini &> /dev/null; then
  echo "Gemini CLI non disponibile — skip, procedi senza."
fi
```
Se il comando non è disponibile, **non usare Gemini CLI** e procedere normalmente con Claude Code. Non interrompere il lavoro per installarlo.

**Quando usare Gemini CLI** (solo se disponibile):
- Researching a specific library API or finding the correct method signature
- Evaluating edge cases or alternative implementations
- Checking model availability on HuggingFace or verifying ONNX compatibility
- Drafting a well-scoped, isolated piece of code (single parser, utility function, regex pattern, standalone React component with no IPC dependencies)

**How to invoke Gemini CLI from Claude Code:**
```bash
gemini -p "Your research question or code drafting request here"
```

Example use cases:
- `gemini -p "What is the correct Transformers.js pipeline syntax for token-classification with Italian_NER_XXL_v2 ONNX model?"`
- `gemini -p "How does adm-zip handle UTF-8 XML content in DOCX files on Windows?"`
- `gemini -p "What are the OCR confidence thresholds in tesseract.js v5 and how to read them?"`
- `gemini -p "Write a TypeScript function that strips Markdown syntax and returns plain text, using only Node.js built-ins"`

**Rules for code drafting via Gemini:**
- Only use Gemini for **isolated, well-specified** tasks (single function, single parser, standalone utility)
- Claude Code must **always review, adapt to project conventions, and commit** the result — never paste Gemini output directly
- Gemini output must comply with TypeScript strict mode, project naming conventions, and IPC security rules
- Document Gemini's contribution in the relevant session file in `sessioni/`

## Critical Rules (Non-Negotiable)

Before making any changes, understand these absolute requirements have priority over any other best practices:

1. **ZERO network calls** during document processing. No external APIs, telemetry, or crash reporting during analysis/anonymization. Only exception: initial model download and optional update check (outside processing flow).
2. **Electron Security:**
   - Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
   - Use only `contextBridge` + `ipcRenderer.invoke/on` for communication
   - Validate ALL IPC inputs in Main process with Zod
3. **TypeScript strict mode everywhere.** No implicit `any` types.
   - **NO Type Cheating:** `// @ts-ignore`, `// @ts-expect-error`, and type assertions `as any` are **STRICTLY FORBIDDEN**. Fix the actual TypeScript interfaces — never silence the compiler.
4. **Incremental development:** One feature/fix at a time. STOP at end of each logical unit and wait for user confirmation before proceeding.
5. **Git commits** before any significant modifications to existing files. Use Conventional Commits:
   - `feat:` new feature visible to the user
   - `fix:` bug fix
   - `refactor:` code change that neither fixes a bug nor adds a feature
   - `chore:` scripts, configs, dependency updates, docs
5b. **CHANGELOG.md**: update `CHANGELOG.md` at the root of the repo every time the version is bumped. Add a new `## [x.y.z] - YYYY-MM-DD` section at the top listing bug fixes and new features in Italian. Never delete existing entries.
5c. **GUIDA.md**: update `GUIDA.md` every time new features, services, components, parsers, or output generators are implemented. Keep each relevant section in sync with the actual code. Never delete existing sections — only extend or correct them.
5d. **CLAUDE.md ↔ GUIDA.md sync:** Le seguenti sezioni devono restare allineate tra i due file:
   - `window.electronAPI Surface` (CLAUDE.md) ↔ sezione API Preload (GUIDA.md)
   - `IPC Channels Reference` (CLAUDE.md) ↔ tabella canali IPC (GUIDA.md)
   - `Architecture` (CLAUDE.md) ↔ sezione Architettura (GUIDA.md)
   Ogni volta che si modifica una delle due, controllare e aggiornare anche l'altra nella stessa sessione/commit.
6. **Privacy logging & Debugging:** NEVER log document content. Only log metadata (sanitized filename, size, format, page count, timing, warnings, error codes).
   - **CRITICAL — anche in debug:** non aggiungere MAI `console.log(text)`, `console.log(content)`, `console.log(entity.value)` su dati provenienti da documenti reali. Usare esclusivamente test Vitest con dati sintetici per debug di parser e NER. I log di sviluppo non devono mai contenere contenuto documentale — anche temporaneamente.
7. **Temporary files:** Prefer in-memory processing. If temp files needed (OCR rendering): use OS temp directory, random names, immediate cleanup on completion or error.
8. **Mandatory testing for NER/Parser changes:** If you add, modify, or fix a Regex pattern in `nerService.ts`, or change any document parser, you **MUST** write or update the corresponding Vitest unit test in `tests/` before asking for confirmation. Never leave NER/Parser changes untested.

## Versioning (SemVer)

- **PATCH** (x.y.**Z**): bugfix, refactoring senza nuove funzionalità, aggiornamenti dipendenze
- **MINOR** (x.**Y**.0): nuova funzionalità visibile all'utente, nuovo formato supportato, nuovo canale IPC
- **MAJOR** (**X**.0.0): breaking change all'architettura o all'IPC contract

Flusso obbligatorio: bump versione in `package.json` → aggiorna `CHANGELOG.md` → poi fai la build.

## Commands

### Development
```bash
npm start          # Run Electron app in dev mode (electron-vite dev)
npm run ui:dev     # Run Vite dev server (React UI only)
npm run ui:build   # Build renderer process with Vite
npm run typecheck  # TypeScript check without emitting files
npm test           # Run vitest unit tests
```

### Build
```bash
npm run build:electron  # Package app with electron-builder
```

## Architecture

### Process Separation (Electron)

**Main Process** (`src/main/`)
- Has Node.js access (file system, libraries)
- Entry point: `index.ts` - creates BrowserWindow
- `ipcHandlers.ts` - centralized IPC handler registration with Zod validation
- `services/` - all document processing logic:
  - `nerService.ts` - hybrid NER engine (Regex + Transformers.js + optional LLM)
  - `sessionManager.ts` - in-memory substitution dictionary (session persistence)
  - `settingsManager.ts` - LLM configuration persistence on disk
  - `llmService.ts` - client for local LLMs (Ollama/LM Studio) via OpenAI-compatible endpoint
  - `parsers/` - extract text from different formats (txt, docx, odt, pdf, ocr, markdown)
  - `outputGenerators/` - create anonymized output files

**Preload** (`src/preload/`)
- `index.ts` - exposes minimal API via `contextBridge` to renderer

**Renderer** (`src/renderer/`)
- React app with ZERO Node.js access (sandboxed)
- `src/store/sessionStore.ts` - Zustand state management
- `src/components/` - UI components (DropZone, ProcessingScreen, EntityReview, BatchReview, SuccessScreen, BatchSuccess, Settings)

**React Rules (Renderer):**
- **Styling:** Use ONLY Tailwind CSS classes. Do **not** create inline styles (`style={{...}}`) or new `.css` files unless strictly unavoidable and explicitly approved.
- **State:** Use the Zustand store (`sessionStore.ts`) for any state shared between components. Reserve `useState` exclusively for transient, strictly local UI state (e.g., dropdown open/close, local form input before submission).

**Shared** (`src/shared/`)
- `types.ts` - TypeScript interfaces shared between Main and Renderer (IPC contracts, entity types, channels)

### Document Processing Flow
```
File dropped
  → ipcHandlers.ts (Zod validation)
  → Format detection
  → Parser (txt/docx/odt/pdf/ocr/markdown) → extracts text
  → nerService.ts
      ├─ Regex patterns (CF, P.IVA, IBAN, Email, Tel, legal structures)
      ├─ Transformers.js NER (Italian_NER_XXL_v2 ONNX model)
      └─ LLM locale (optional, Ollama/LM Studio)
  → sessionManager.ts (enriches with previously assigned roles)
  → IPC: doc:complete
  → Renderer: EntityReview.tsx (user reviews/confirms)
  → IPC: doc:anonymize
  → outputGenerators/ (format-specific anonymization)
  → Save: [original]_anonimizzato.[ext]
  → Update sessionManager
```

### Key Libraries

**Documents:**
- `pdfjs-dist` - extract text + coordinates from native PDFs
- `mupdf` - PDF redaction (removes text glyphs from PDF)
- `pdf-lib` - PDF manipulation (overlay grey rectangles + pseudonyms)
- `adm-zip` - parse/rebuild DOCX/ODT (ZIP + XML)
- `fast-xml-parser` - parse XML content inside DOCX/ODT archives
- `tesseract.js` - offline OCR (tessdata downloaded at first run)

**NER (Named Entity Recognition):**
- Regex for structured Italian data (Codice Fiscale, Partita IVA, IBAN, Email, Phone) and 11 legal structure patterns
- `@huggingface/transformers` (Transformers.js) - local NER with **`DeepMount00/Italian_NER_XXL_v2`** ONNX model
- 52 Italian legal entity categories (AVV_NOTAIO, TRIBUNALE, N_SENTENZA, LEGGE, PERSONA, LUOGO, ORGANIZZAZIONE, etc.)
- Optional LLM level (Ollama / LM Studio) for additional entity extraction
- Model downloaded at first run (not bundled) to `app.getPath('userData')`
- Decision rationale: see `sessioni/sessione_001_fase1.md`

**UI:**
- `tailwindcss` - styling
- `lucide-react` - icons
- `zustand` - state management
- `react-dropzone` - drag & drop

**Quality:**
- `zod` - IPC input validation
- `winston` - logging
- `vitest` - testing

## File Structure
```
/
├── PROJECT_MASTER v2.1.md  # Primary reference doc - read before operating
├── CLAUDE.md               # This file — keep in sync with GUIDA.md
├── GUIDA.md                # Full technical documentation — keep in sync with CLAUDE.md
├── CHANGELOG.md            # Version history in Italian
├── sessioni/               # Session logs — read latest before starting work
│   └── sessione_NNN_faseN.md
├── package.json
├── resources/              # App assets (icons, tessdata, NER model)
├── scripts/
│   └── build-mac.sh        # Unified arm64 + x64 build script
├── src/
│   ├── main/               # Node.js process
│   │   ├── index.ts
│   │   ├── ipcHandlers.ts
│   │   ├── parsers/
│   │   ├── outputGenerators/
│   │   └── services/
│   ├── preload/
│   │   └── index.ts        # contextBridge API
│   ├── renderer/           # React app (sandboxed)
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       └── store/
│   └── shared/
│       └── types.ts        # Shared TypeScript interfaces
└── tests/
```

## Development Workflow
1. **Run Session Startup Checklist** (see above)
2. **Read PROJECT_MASTER v2.1.md** for the overall roadmap and post-launch priorities
3. All 6 initial phases are **DONE** — new work consists of feature extensions, bugfixes, and quality improvements:
   - Phase 1: Setup & Scaffolding — **DONE** (see sessione_001_fase1.md)
   - Phase 2: NER Engine + SessionManager — **DONE**
   - Phase 3: Document Parsers (TXT/DOCX/ODT/MD) — **DONE**
   - Phase 4: PDF Native + OCR — **DONE**
   - Phase 5: User Interface — **DONE**
   - Phase 6: Packaging & Auto-update — **DONE**
4. Implement one feature/fix at a time, stop and wait for confirmation
5. Read files before modifying them
6. Commit before significant changes
7. Run `npm run typecheck` after every change; run `npm test` when tests exist
8. Update `sessioni/` at end of each session

## IPC Security Pattern

All IPC handlers must validate inputs with Zod schemas before processing:

```typescript
const ProcessDocumentSchema = z.object({
  filePath: z.string().min(1).refine(
    (p) => ['.pdf','.docx','.odt','.txt','.md','.png','.jpg','.jpeg'].some(ext => p.toLowerCase().endsWith(ext)),
    { message: 'Formato file non supportato' }
  ),
});
```

Use IPC channel constants from `src/shared/types.ts` - never hardcode strings.

## IPC Channels Reference

All channels are defined as constants in `src/shared/types.ts`. Never hardcode channel name strings.

### Renderer → Main (`ipcRenderer.invoke` / `ipcMain.handle`)

| Channel | Input | Output |
|---------|-------|--------|
| `doc:process` | `{ filePath: string }` | `DocumentAnalysisResult` |
| `doc:anonymize` | `AnonymizeRequest` | `AnonymizeResult` |
| `batch:anonymize` | `AnonymizeRequest[]` | `BatchResult[]` |
| `session:reset` | none | `{ status: string }` |
| `settings:get` | none | `{ llm: LlmConfig }` |
| `settings:set` | `{ llm: LlmConfig }` | `{ status: string }` |
| `llm:test` | `LlmConfig` | `{ ok: boolean, message: string }` |
| `llm:listModels` | `{ baseUrl: string }` | `{ models: string[] }` |
| `llm:getDefaultPrompt` | `{ lang: 'it' \| 'en' }` | `string` |
| `app:getVersion` | none | `string` |
| `shell:showInFolder` | `{ filePath: string }` | `void` |
| `diag:collect` | none | `string` (copied to clipboard) |
| `model:status` | none | `{ present: boolean, path: string }` |
| `model:download` | none | streams progress events via `model:download:progress` |

### Main → Renderer (`webContents.send` / `ipcRenderer.on`)

| Channel | Payload |
|---------|---------|
| `doc:progress` | `{ stage: 'parsing' \| 'ner' \| 'ocr' \| 'done', percent: number, message: string }` |
| `model:download:progress` | `{ file: string, percent: number, done: boolean, error?: string }` |

> ⚠️ **Direzione Main → Renderer:** usare sempre `mainWindow.webContents.send(channel, data)`.
> `ipcMain.send()` NON esiste — è un errore comune. I listener sul lato Renderer devono
> essere rimossi al cleanup (vedi Performance — Livello 1).

## window.electronAPI Surface

Tutti i metodi esposti da `src/preload/index.ts` via `contextBridge`. Disponibili nel Renderer come `window.electronAPI.*`.

```typescript
// Operazioni documento
processDocument(filePath: string): Promise<DocumentAnalysisResult>
anonymizeDocument(req: AnonymizeRequest): Promise<AnonymizeResult>
batchAnonymize(reqs: AnonymizeRequest[]): Promise<BatchResult[]>
resetSession(): Promise<{ status: string }>

// Progresso (Main → Renderer push events)
onProgress(callback: (p: ProgressPayload) => void): () => void  // ritorna fn di unsub

// Impostazioni
getSettings(): Promise<{ llm: LlmConfig }>
setSettings(config: { llm: LlmConfig }): Promise<{ status: string }>

// LLM
testLlm(config: LlmConfig): Promise<{ ok: boolean; message: string }>
listLlmModels(baseUrl: string): Promise<{ models: string[] }>
getDefaultPrompt(lang: 'it' | 'en'): Promise<string>

// Utility
getAppVersion(): Promise<string>
showInFolder(filePath: string): void
getPathForFile(file: File): string  // path assoluto da File object drag-drop

// Modello NER
modelStatus(): Promise<{ present: boolean; path: string }>
downloadModel(): Promise<void>  // progress via model:download:progress events

// Diagnostica
collectDiagnostics(): Promise<string>
```

> Un componente React che non interagisce con file o IPC usa **solo** lo Zustand store
> (`src/store/sessionStore.ts`) — non ha bisogno di `window.electronAPI`.

## IPC Testing Pattern

Non testare gli handler IPC direttamente. Isola la logica nei service e testala in modo puro.

```typescript
// ✅ Testa la logica nel service, senza IPC
import { analyzeText } from '../src/main/services/nerService';

it('riconosce codice fiscale', async () => {
  const result = await analyzeText('Il sig. RSSMRA80A01H501U è presente');
  expect(result.entities).toContainEqual(
    expect.objectContaining({ type: 'CODICE_FISCALE', value: 'RSSMRA80A01H501U' })
  );
});

// ✅ Mock di window.electronAPI per test componenti Renderer
vi.stubGlobal('electronAPI', {
  processDocument: vi.fn().mockResolvedValue({ entities: [], warnings: [] }),
  onProgress: vi.fn().mockReturnValue(() => {}), // ritorna sempre la fn di unsub
  getSettings: vi.fn().mockResolvedValue({ llm: { provider: 'ollama', model: 'llama3' } }),
  anonymizeDocument: vi.fn().mockResolvedValue({ outputPath: '/tmp/out.pdf', entitiesReplaced: 3 }),
});

// ❌ Non fare questo — ipcMain non è disponibile in vitest
// ipcMain.handle('doc:process', handler); // → errore in test environment
```

## Regex Patterns for Italian Data

Located in `src/main/services/nerService.ts`. Uses `\b` word boundaries (NOT `^`/`$`) because matching happens on extracted paragraph text:

- **CODICE_FISCALE:** `/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi`
- **PARTITA_IVA:** `/\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi`
- **IBAN:** `/\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi`
- **EMAIL:** `/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi`
- **TELEFONO:** `/\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g`

## Error Handling

- File not supported → reject gracefully with clear message
- Password-protected PDF → catch exception, inform user
- Scanned PDF (low text) → auto-switch to OCR, show warning
- Low OCR confidence (<60%) → proceed but add warning
- NER model not found → fallback to regex-only
- Corrupt DOCX → catch exception, suggest re-saving
- Write permission error → log and show specific error
- LLM not reachable → skip LLM level, proceed with regex + BERT only

## Known Build Issues

### sharp darwin-arm64 crash (building arm64 DMG from x64 machine)

**Symptom:** App crashes on launch with `Error: Could not load the "sharp" module using the darwin-arm64 runtime`.

**Cause:** `@huggingface/transformers` imports `sharp` at top-level. When building the arm64 DMG from an x64 machine, npm installs x64 binaries (`@img/sharp-darwin-x64`) but not arm64 ones.

**Fix:** Install arm64 binaries before packaging (already in `dist:mac:arm64` script):
```bash
npm install @img/sharp-darwin-arm64@0.34.5 @img/sharp-libvips-darwin-arm64@1.2.4 --force --no-save
```

Use `--force` to bypass npm's platform check. Use `--no-save` to avoid modifying `package.json`.

If sharp version changes, find the correct versions with:
```bash
cat node_modules/@img/sharp-darwin-x64/package.json | python3 -m json.tool | grep '"version"'
cat node_modules/@img/sharp-libvips-darwin-x64/package.json | python3 -m json.tool | grep '"version"'
```

### hdiutil fails on iCloud Drive

**Symptom:** `hdiutil: create failed - Risorsa momentaneamente non disponibile` during DMG creation.

**Cause:** `hdiutil` cannot create DMG files inside iCloud Drive-synced folders.

**Fix:** The `dist:mac:arm64` script has an automatic fallback that creates the DMG on `~/Desktop/` when electron-builder fails. Same fallback is in `scripts/build-mac.sh` for both architectures.

Alternatively:
```bash
hdiutil create -volname "Anonimator" -srcfolder dist/mac-arm64/Anonimator.app -ov -format UDZO ~/Desktop/Anonimator-arm64.dmg
```

Full details: `sessioni/sessione_019_sharp_arm64_fix.md`

### Build arm64 + x64 automatica (script unificato)
```bash
npm run dist:mac:both
# oppure direttamente:
bash scripts/build-mac.sh
```

Lo script `scripts/build-mac.sh`:
1. Fa una sola build vite
2. Installa binari sharp arm64 → pacchetta DMG arm64
3. Installa binari sharp x64 → pacchetta DMG x64
4. Fallback hdiutil su Desktop per entrambi se iCloud Drive blocca
5. Ripristina binari arm64 (macchina di build)

**Universal binary NON è supportato** (lovell/sharp#3622): i `.dylib` libvips sono arch-specific e non mergeable con `lipo`. Si distribuiscono due DMG separati.

## Performance & Ottimizzazioni

Le linee guida seguono un approccio a tre livelli: applica prima il Livello 1 (impatto immediato, zero rischio), poi il Livello 2 (ottimizzazioni mirate), poi il Livello 3 solo se ci sono problemi documentati.

### Livello 1 — Regole base (sempre valide, impatto immediato)

- **BrowserWindow startup percepito:** creare la finestra con `show: false` e mostrarla solo all'evento `ready-to-show`. Evita il flash di finestra bianca.
```typescript
win.once('ready-to-show', () => win.show());
```
- **API Node.js asincrone:** usare sempre `fs.promises.*` nel main process. Mai `fs.readFileSync`, `fs.writeFileSync` nel percorso critico — bloccano il main thread e congelano l'intera app.
- **Cleanup listener React:** ogni `useEffect` che registra un listener IPC o un timer deve restituire una funzione di cleanup. I memory leak si accumulano in app desktop long-running (gli utenti non chiudono mai l'app).
```typescript
useEffect(() => {
  const unsub = window.electronAPI.onProgress(handler);
  return () => unsub(); // cleanup obbligatorio
}, []);
```
- **`ipcRenderer.invoke` sempre (mai `sendSync`):** `sendSync` blocca il renderer fino alla risposta del main. Già usato correttamente nel progetto — mantenere questo pattern.
- **Escludere file non necessari dalla build:** nella config `electron-builder`, il campo `files` deve escludere `tests/`, `.git/`, documentazione, file `.md` non necessari a runtime.

### Livello 2 — Ottimizzazioni mirate (applicare quando si toccano le aree interessate)

- **Lazy loading moduli pesanti nel main:** caricare `mupdf`, `tesseract.js` e altri moduli pesanti solo quando servono con `import()` dinamico, non al top-level. Riduce il tempo di avvio.
```typescript
// Invece di: import mupdf from 'mupdf' in cima al file
const mupdf = (await import('mupdf')).default; // dentro la funzione che lo usa
```
- **React.lazy() per componenti pesanti:** componenti non mostrati allo startup (es. SettingsScreen, BatchReview) possono essere caricati con `React.lazy()` + `Suspense`.
- **Audit dipendenze:** prima di aggiungere una nuova libreria, verificare con `npx depcheck` se ci sono dipendenze inutilizzate da rimuovere. Preferire alternative leggere (es. `crypto.randomUUID()` invece di `uuid`).
- **Compressione build:** in `electron-builder.yml` impostare `compression: maximum`. Per eseguibili Windows, valutare UPX (riduce dimensione ma alcuni antivirus segnalano falsi positivi).
- **Immagini:** usare WebP invece di PNG/JPG per asset UI (30% più piccoli). Font in WOFF2 con subset dei soli caratteri italiani necessari.

### Livello 3 — Avanzate (solo se ci sono problemi documentati e misurati)

- **Worker threads per operazioni CPU-intensive:** se NER o OCR bloccano il main process in modo misurabile, spostare in un `worker_thread`. Attualmente il singleton `_nerQueue` con concurrency=1 mitiga il problema.
- **Bundle analysis:** usare `vite-bundle-visualizer` (`npx vite-bundle-visualizer`) per identificare dipendenze pesanti nel renderer bundle.
- **Memory profiling:** aprire Chrome DevTools nel renderer (`Ctrl+Shift+I` in dev) → tab Memory → heap snapshot. Nel main process usare `--inspect` e connettersi da `chrome://inspect`. Cercare listener IPC non rimossi e closure che trattengono oggetti.
- **Universal Binary macOS:** per distribuire un unico DMG per Intel + Apple Silicon usare `arch: ["universal"]` in electron-builder. Raddoppia la dimensione del file ma elimina la gestione di due canali separati. Attualmente si usano build separati — cambiare solo se la distribuzione diventa un problema.

### Strumenti di misura (prima di ottimizzare, misurare)

```bash
npx depcheck               # dipendenze inutilizzate
npx vite-bundle-visualizer # analisi bundle renderer
# Chrome DevTools > Performance tab: profiling runtime
# Chrome DevTools > Memory tab: heap snapshot per memory leak
```

---

## Build — Istruzione utente

Quando l'utente dice **"fai la build"** o **"fai il build"** intende sempre: **pubblicare un nuovo tag su GitHub per triggerare la CI/CD** (`git tag vX.Y.Z && git push origin vX.Y.Z`). NON avviare build locali (`npm run dist:mac:arm64`, ecc.) a meno che non sia esplicitamente richiesto.

Passaggi standard per una release:
1. Verificare che `package.json` abbia la versione aggiornata
2. `git tag vX.Y.Z`
3. `git push origin master --tags`
4. La CI (`.github/workflows/release.yml`) produce automaticamente DMG arm64, DMG x64, .exe Windows

---

## Notes

- Vite version pinned to ^5.4.x (electron-vite 2.3 does not support Vite 6)
- NER model changed from generic Xenova to Italian_NER_XXL_v2 (decision: sessione_001_fase1.md)
- Prefer simplicity over elegance - target users are lawyers, not developers
- Don't refactor working code without explicit request
- Don't install libraries not mentioned in PROJECT_MASTER v2.1.md without asking first
- When uncertain between approaches, describe pros/cons and wait for user decision
