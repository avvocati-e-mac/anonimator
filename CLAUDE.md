# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Desktop Electron application for **local pseudonymization** of Italian legal documents (PDF, DOCX, ODT, TXT, images). Target users are lawyers with low technical skills. All processing happens **offline** - no network access during document processing to comply with GDPR and professional secrecy requirements.

**Tech Stack:** Electron + React 18 + TypeScript (strict mode)

## Session Memory

Before starting any work, read the latest file in `sessioni/` to understand what was done in previous sessions, which decisions were made, and what the current state of the project is. After completing significant work, update or create a new session file in `sessioni/` documenting decisions, files changed, and next steps.

Session files are named: `sessione_NNN_faseN.md` (e.g. `sessione_001_fase1.md`)

## AI Agent Roles

### Claude Code (primary)
- Writes/modifies all repo files, runs build/test, controlled refactoring, debugging
- Implements the roadmap phase by phase, stops at end of each phase for user confirmation
- Updates `sessioni/` files after each significant work session

### Gemini CLI (secondary — research only, does NOT modify files)
Use Gemini CLI for targeted research when needed. Invoke it from Claude Code via Bash when:
- Researching a specific library API or finding the correct method signature
- Evaluating edge cases or alternative implementations
- Checking model availability on HuggingFace or verifying ONNX compatibility

**How to invoke Gemini CLI from Claude Code:**
```bash
gemini -p "Your research question here"
```

Example use cases:
- `gemini -p "What is the correct Transformers.js pipeline syntax for token-classification with Italian_NER_XXL_v2 ONNX model?"`
- `gemini -p "How does adm-zip handle UTF-8 XML content in DOCX files on Windows?"`
- `gemini -p "What are the OCR confidence thresholds in tesseract.js v5 and how to read them?"`

Gemini CLI findings should be documented in the relevant session file in `sessioni/`.

## Critical Rules (Non-Negotiable)

Before making any changes, understand these absolute requirements have priority over any other best practices:

1. **ZERO network calls** during document processing. No external APIs, telemetry, or crash reporting during analysis/anonymization. Only exception: optional update check (outside processing flow).

2. **Electron Security:**
   - Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
   - Use only `contextBridge` + `ipcRenderer.invoke/on` for communication
   - Validate ALL IPC inputs in Main process with Zod

3. **TypeScript strict mode everywhere.** No implicit `any` types.

4. **Incremental development:** Implement one phase at a time from the roadmap in PROJECT_MASTER v2.1.md. STOP at end of each phase and wait for user confirmation.

5. **Git commits** before any significant modifications to existing files.

5b. **CHANGELOG.md**: update `CHANGELOG.md` at the root of the repo every time the version is bumped. Add a new `## [x.y.z] - YYYY-MM-DD` section at the top listing bug fixes and new features in Italian. Never delete existing entries.

6. **Privacy logging:** NEVER log document content. Only log metadata (sanitized filename, size, format, page count, timing, warnings, error codes).

7. **Temporary files:** Prefer in-memory processing. If temp files needed (OCR rendering): use OS temp directory, random names, immediate cleanup on completion or error.

## Commands

### Development
```bash
npm start              # Run Electron app in dev mode (electron-vite dev)
npm run ui:dev         # Run Vite dev server (React UI only)
npm run ui:build       # Build renderer process with Vite
npm run typecheck      # TypeScript check without emitting files
npm test               # Run vitest unit tests
```

### Build
```bash
npm run build:electron # Package app with electron-builder
```

## Architecture

### Process Separation (Electron)

**Main Process** (`src/main/`)
- Has Node.js access (file system, libraries)
- Entry point: `index.ts` - creates BrowserWindow
- `ipcHandlers.ts` - centralized IPC handler registration with Zod validation
- `services/` - all document processing logic:
  - `nerService.ts` - hybrid NER engine (Transformers.js + Regex)
  - `sessionManager.ts` - in-memory substitution dictionary (session persistence)
  - `parsers/` - extract text from different formats (txt, docx, odt, pdf, ocr)
  - `outputGenerators/` - create anonymized output files

**Preload** (`src/preload/`)
- `index.ts` - exposes minimal API via `contextBridge` to renderer

**Renderer** (`src/renderer/`)
- React app with ZERO Node.js access (sandboxed)
- `src/store/sessionStore.ts` - Zustand state management
- `src/components/` - UI components (DropZone, ProcessingScreen, EntityReview, SuccessScreen)

**Shared** (`src/shared/`)
- `types.ts` - TypeScript interfaces shared between Main and Renderer (IPC contracts, entity types, channels)

### Document Processing Flow

```
File dropped → ipcHandlers.ts (Zod validation)
  → Format detection
    → Parser (txt/docx/odt/pdf/ocr) → extracts text
      → nerService.ts
        ├─ Regex patterns (CF, P.IVA, IBAN, Email, Tel)
        └─ Transformers.js NER (Italian_NER_XXL_v2 ONNX model)
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
- `pdf-lib` - PDF manipulation (create output with white rectangles + pseudonyms)
- `adm-zip` - parse/rebuild DOCX/ODT (ZIP + XML)
- `fast-xml-parser` - parse XML content inside DOCX/ODT archives
- `tesseract.js` - offline OCR with bundled `resources/tessdata/ita.traineddata`

**NER (Named Entity Recognition):**
- Regex for structured Italian data (Codice Fiscale, Partita IVA, IBAN, Email, Phone)
- `@huggingface/transformers` (Transformers.js) - local NER with **`DeepMount00/Italian_NER_XXL_v2`** ONNX model
  - 52 Italian legal entity categories (AVV_NOTAIO, TRIBUNALE, N_SENTENZA, LEGGE, PERSONA, LUOGO, ORGANIZZAZIONE, etc.)
  - Model loaded from `resources/models/` (bundled, NO runtime downloads)
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
├── PROJECT_MASTER v2.1.md    # Primary reference doc - read before operating
├── CLAUDE.md                 # This file
├── sessioni/                 # Session logs — read latest before starting work
│   └── sessione_NNN_faseN.md
├── package.json
├── resources/                # Bundled assets (never downloaded at runtime)
│   ├── models/               # ONNX quantized NER model (Italian_NER_XXL_v2)
│   └── tessdata/             # Italian OCR training data (ita.traineddata)
├── src/
│   ├── main/                 # Node.js process
│   │   ├── index.ts
│   │   ├── ipcHandlers.ts
│   │   ├── parsers/
│   │   ├── outputGenerators/
│   │   └── services/
│   ├── preload/
│   │   └── index.ts          # contextBridge API
│   ├── renderer/             # React app (sandboxed)
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       └── store/
│   └── shared/
│       └── types.ts          # Shared TypeScript interfaces
└── tests/
```

## Development Workflow

1. **Read latest file in `sessioni/`** to understand current project state
2. **Read PROJECT_MASTER v2.1.md** for the overall roadmap
3. Follow the 6-phase roadmap:
   - Phase 1: Setup & Scaffolding — DONE (see sessione_001_fase1.md)
   - Phase 2: NER Engine + SessionManager
   - Phase 3: Document Parsers (TXT/DOCX/ODT)
   - Phase 4: PDF Native + OCR
   - Phase 5: User Interface
   - Phase 6: Packaging & Auto-update
4. Implement one phase at a time, stop and wait for confirmation
5. Read files before modifying them
6. Commit before significant changes
7. Run `npm run typecheck` after every change; run `npm test` when tests exist
8. Update `sessioni/` at end of each session

## IPC Security Pattern

All IPC handlers must validate inputs with Zod schemas before processing:

```typescript
const ProcessDocumentSchema = z.object({
  filePath: z.string().min(1).refine(
    (p) => ['.pdf','.docx','.odt','.txt','.png','.jpg','.jpeg'].some(ext => p.endsWith(ext)),
    { message: 'Formato file non supportato' }
  ),
});
```

Use IPC channel constants from `src/shared/types.ts` - never hardcode strings.

## Regex Patterns for Italian Data

Located in `src/main/services/nerService.ts`. Uses `\b` word boundaries (NOT `^`/`$`) because matching happens on extracted paragraph text:

- **CODICE_FISCALE:** `/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi`
- **PARTITA_IVA:** `/\b(?:P\.?\s?IVA\s*)?([0-9]{11})\b/gi`
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

**Fix:** The `dist:mac:arm64` script has an automatic fallback that creates the DMG on `~/Desktop/` when electron-builder fails. Same fallback is in `scripts/build-mac.sh` for both architectures. Alternatively:
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
npx depcheck                    # dipendenze inutilizzate
npx vite-bundle-visualizer      # analisi bundle renderer
# Chrome DevTools > Performance tab: profiling runtime
# Chrome DevTools > Memory tab: heap snapshot per memory leak
```

---

## Build — Istruzione utente

Quando l'utente dice **"fai la build"** o **"fai il build"** intende sempre:
**pubblicare un nuovo tag su GitHub per triggerare la CI/CD** (`git tag vX.Y.Z && git push origin vX.Y.Z`).

NON avviare build locali (`npm run dist:mac:arm64`, ecc.) a meno che non sia esplicitamente richiesto.

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
