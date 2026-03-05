# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Desktop Electron application for **local pseudonymization** of Italian legal documents (PDF, DOCX, ODT, TXT, images). Target users are lawyers with low technical skills. All processing happens **offline** - no network access during document processing to comply with GDPR and professional secrecy requirements.

**Tech Stack:** Electron + React 18 + TypeScript (strict mode)

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
npm start              # Run Electron app in dev mode
npm run ui:dev         # Run Vite dev server (React UI only)
npm run ui:build       # Build renderer process with Vite
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
        └─ Transformers.js NER (PERSONA/LUOGO/ORGANIZZAZIONE)
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
- `tesseract.js` - offline OCR with bundled `resources/tessdata/ita.traineddata`

**NER (Named Entity Recognition):**
- Regex for structured Italian data (Codice Fiscale, Partita IVA, IBAN, Email, Phone)
- `@huggingface/transformers` (Transformers.js) - local NER model for PERSON/LOCATION/ORGANIZATION
- Models loaded from `resources/models/` (bundled, no runtime downloads)

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
├── package.json
├── resources/                # Bundled assets
│   ├── models/               # ONNX quantized NER model
│   └── tessdata/             # Italian OCR training data
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

1. **Read PROJECT_MASTER v2.1.md** completely before making changes
2. Follow the 6-phase roadmap defined in PROJECT_MASTER v2.1.md:
   - Phase 1: Setup & Scaffolding
   - Phase 2: NER Engine + SessionManager
   - Phase 3: Document Parsers (TXT/DOCX/ODT)
   - Phase 4: PDF Native + OCR
   - Phase 5: User Interface
   - Phase 6: Packaging & Auto-update
3. Implement one phase at a time, stop and wait for confirmation
4. Read files before modifying them
5. Commit before significant changes
6. Run tests after changes: `vitest` (when tests exist)

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

- Current state: Project scaffolded with basic folder structure and package.json
- No source code files exist yet (awaiting Phase 1 completion)
- Prefer simplicity over elegance - target users are lawyers, not developers
- Don't refactor working code without explicit request
- Don't install libraries not mentioned in PROJECT_MASTER v2.1.md without asking first
- When uncertain between approaches, describe pros/cons and wait for user decision
