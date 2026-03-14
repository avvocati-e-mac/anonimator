# Sessione 013 — Piano: Multi-Document Batch Processing

**Data:** 2026-03-06
**Stato:** PIANIFICAZIONE — da implementare

---

## Obiettivo

Aggiungere il supporto al caricamento e anonimizzazione di più documenti contemporaneamente. I documenti di uno stesso fascicolo condividono le stesse persone/organizzazioni: il `sessionManager` (già singleton in-memory) garantisce consistenza automatica dei pseudonimi tra file.

---

## Decisioni utente

- **Revisione:** lista unificata e deduplicata dopo l'analisi di tutti i file (non sequenziale per file)
- **Errori:** se un file fallisce l'analisi, l'app avvisa e chiede "Riprova / Salta"

---

## Flusso Batch

```
DropZone (drop N file)
  → mostra coda file con "Avvia analisi"
    → BatchProcessingScreen (analisi seriale: file 1/N, 2/N...)
      → [se errore] → dialog "Riprova / Salta"
        → BatchReview (lista unificata entità con badge "×N file")
          → BatchProcessingScreen (anonimizzazione seriale)
            → BatchSuccessScreen (riepilogo per file)
```

Il flusso singolo-documento (`dropzone → processing → review → success`) rimane **invariato** quando viene trascinato 1 solo file.

---

## File da modificare / creare

| File | Tipo | Note |
|------|------|------|
| `src/shared/types.ts` | modifica | Nuovi tipi batch + canale IPC |
| `src/renderer/src/store/sessionStore.ts` | modifica | Stato batch + azioni |
| `src/preload/index.ts` | modifica | `batchAnonymize` esposto |
| `src/renderer/src/env.d.ts` | modifica | Tipo `ElectronAPI.batchAnonymize` |
| `src/main/ipcHandlers.ts` | modifica | Handler `batch:anonymize` con Zod |
| `src/renderer/src/App.tsx` | modifica | 3 nuovi screen + progress routing |
| `src/renderer/src/components/DropZone.tsx` | modifica | Multi-file, coda UI, orchestrazione |
| `src/renderer/src/utils/entityUtils.ts` | **nuovo** | `mergeEntities()` pura |
| `src/renderer/src/hooks/useBatchOrchestrator.ts` | **nuovo** | Loop seriale + dialog errore |
| `src/renderer/src/components/BatchProcessingScreen.tsx` | **nuovo** | Progress batch con lista file |
| `src/renderer/src/components/BatchReview.tsx` | **nuovo** | Lista unificata + badge "×N file" |
| `src/renderer/src/components/BatchSuccessScreen.tsx` | **nuovo** | Riepilogo per file |

**File NON da toccare:** `nerService.ts`, `sessionManager.ts`, tutti i parsers, tutti gli outputGenerators, `EntityReview.tsx`, `ProcessingScreen.tsx`, `SuccessScreen.tsx`, `SettingsScreen.tsx`.

---

## Dettaglio implementazione

### 1. `src/shared/types.ts`
```typescript
// Aggiungere a DetectedEntity:
fileCount?: number

// Nuovi tipi:
export type BatchFileStatus = 'pending' | 'analyzing' | 'done' | 'error'

export interface BatchFileItem {
  filePath: string
  fileName: string
  status: BatchFileStatus
  analysisResult?: DocumentAnalysisResult
  error?: string
}

export interface BatchSaveResult {
  filePath: string
  fileName: string
  outputPath?: string
  entitiesReplaced?: number
  error?: string
}

// IPC_CHANNELS aggiungere:
BATCH_ANONYMIZE: 'batch:anonymize'
```

### 2. `src/renderer/src/store/sessionStore.ts`
Estendere `AppScreen`:
```typescript
type AppScreen = 'dropzone' | 'processing' | 'review' | 'success' |
  'batch-processing' | 'batch-review' | 'batch-success'
```
Nuovi campi:
- `isBatchMode: boolean`
- `batchFiles: BatchFileItem[]`
- `batchCurrentFileIndex: number`
- `mergedEntities: DetectedEntity[]`
- `batchResults: BatchSaveResult[]`

Nuove azioni: `setBatchFiles`, `updateBatchFile`, `setMergedEntities`, `updateMergedEntityPseudonym`, `toggleMergedEntityConfirmed`, `setBatchResults`, `resetBatchOnly()`.

### 3. `src/renderer/src/utils/entityUtils.ts` (nuovo)
```typescript
export function mergeEntities(results: DocumentAnalysisResult[]): DetectedEntity[]
```
- Deduplicazione su `originalText.toLowerCase()`
- Somma `occurrences`, imposta `fileCount`
- Mantiene primo `pseudonym` (sessionManager garantisce consistenza)
- Ordina per `occurrences` desc

### 4. `src/renderer/src/hooks/useBatchOrchestrator.ts` (nuovo)
- Loop seriale `processDocument` per ogni file
- Su errore: stato locale `pendingErrorFile` → mostra dialog "Riprova / Salta" (overlay)
- Su successo: `updateBatchFile({status:'done', analysisResult})`
- Fine loop: `mergeEntities()` → `setMergedEntities()` → `setScreen('batch-review')`

### 5. `src/renderer/src/components/DropZone.tsx`
- Listener capture phase: `Array.from(e.dataTransfer.files).map(f => getPathForFile(f))` → `string[]` ref
- react-dropzone: `maxFiles: 20`, `multiple: true`
- `onDrop`: se 1 file → flusso esistente; se N>1 → `setBatchFiles()`, mostrare coda
- UI coda: lista file + bottone × per rimuovere + "Avvia analisi"

### 6. `src/main/ipcHandlers.ts`
```typescript
ipcMain.handle(IPC_CHANNELS.BATCH_ANONYMIZE, async (_event, payload) => {
  const parsed = z.array(AnonymizeRequestSchema).safeParse(payload)
  // loop seriale: generateOutput() per ogni request
  // sendProgress con fileIndex/fileTotal/fileName opzionali (retrocompatibile)
  return results as BatchSaveResult[]
})
```

### 7. `BatchReview.tsx` — logica chiave
Filtro entità per file (evita di inviare a ogni file entità che non vi compaiono):
```typescript
requests = batchFiles.filter(f => f.status === 'done').map(f => ({
  filePath: f.filePath,
  entities: mergedEntities.filter(e =>
    f.analysisResult!.entities.some(fe =>
      fe.originalText.toLowerCase() === e.originalText.toLowerCase()
    )
  )
}))
```

### 8. `BatchSuccessScreen.tsx`
- Riepilogo per file (check verde / X rossa)
- "Aggiungi altri documenti" → `resetBatchOnly()` (pseudonimi sessione preservati)
- "Nuova sessione" → `resetSession()` + `reset()` completo

---

## Versioning
- `1.0.2` → `1.0.3`
- Aggiornare `CHANGELOG.md` con sezione `## [1.0.3] - 2026-03-06`

---

## Vincoli rispettati
- TypeScript strict, zero `any` impliciti
- Renderer sandbox: tutto via IPC / contextBridge
- Zod su tutti i nuovi handler IPC
- NER pipeline seriale (no race sul singleton ONNX)
- Nessun log di contenuto documenti
- Nessuna nuova dipendenza esterna
