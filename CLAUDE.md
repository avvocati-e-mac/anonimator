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

## Notes

- Vite version pinned to ^5.4.x (electron-vite 2.3 does not support Vite 6)
- NER model changed from generic Xenova to Italian_NER_XXL_v2 (decision: sessione_001_fase1.md)
- Prefer simplicity over elegance - target users are lawyers, not developers
- Don't refactor working code without explicit request
- Don't install libraries not mentioned in PROJECT_MASTER v2.1.md without asking first
- When uncertain between approaches, describe pros/cons and wait for user decision
