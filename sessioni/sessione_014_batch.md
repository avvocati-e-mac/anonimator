# Sessione 014 — Multi-Document Batch Processing

**Data:** 2026-03-06
**Versione:** 1.0.2 → 1.0.3

## Obiettivo

Implementare l'elaborazione batch di più documenti in un colpo solo, mantenendo coerenza dei pseudonimi tra file tramite `sessionManager`.

## Flusso implementato

```
DropZone (drop N file)
  → mostra coda file con "Avvia analisi"
    → BatchProcessingScreen (analisi seriale: file 1/N, 2/N, ...)
      → [se errore] → dialog "Riprova / Salta"
        → BatchReview (lista unificata entità con badge "×N file")
          → BatchProcessingScreen (anonimizzazione seriale)
            → BatchSuccessScreen (riepilogo per file)
```

Il flusso singolo documento rimane invariato (1 file → processing → review → success).

## File modificati

| File | Tipo | Descrizione |
|------|------|-------------|
| `src/shared/types.ts` | modifica | `fileCount?` in `DetectedEntity`; `BatchFileStatus`, `BatchFileItem`, `BatchSaveResult`; `IPC_CHANNELS.BATCH_ANONYMIZE` |
| `src/renderer/src/store/sessionStore.ts` | modifica | Nuove screen batch; stato batch (isBatchMode, batchFiles, mergedEntities, batchResults, batchCurrentFileIndex); azioni batch |
| `src/preload/index.ts` | modifica | `batchAnonymize(requests)` via `batch:anonymize` IPC |
| `src/renderer/src/env.d.ts` | modifica | Firma `batchAnonymize` in `ElectronAPI` |
| `src/main/ipcHandlers.ts` | modifica | Handler `BATCH_ANONYMIZE`; `sendProgress` esteso con `fileIndex/fileTotal/fileName` opzionali |
| `src/renderer/src/App.tsx` | modifica | 3 nuovi screen batch; listener progress aggiornato per batch mode |
| `src/renderer/src/components/DropZone.tsx` | modifica | Multi-file (maxFiles=20); coda file con rimozione singola; bottone "Avvia analisi"; dialog errore |
| `src/renderer/src/utils/entityUtils.ts` | nuovo | `mergeEntities()`: deduplicazione, somma occorrences, fileCount, ordinamento |
| `src/renderer/src/hooks/useBatchOrchestrator.ts` | nuovo | Custom hook con `startBatchAnalysis()` + dialog errore retry/skip |
| `src/renderer/src/components/BatchProcessingScreen.tsx` | nuovo | Pannello laterale lista file + progresso corrente + progresso globale |
| `src/renderer/src/components/BatchReview.tsx` | nuovo | Revisione unificata con badge file count, pseudonimi editabili |
| `src/renderer/src/components/BatchSuccessScreen.tsx` | nuovo | Riepilogo per file, bottoni mostra cartella / aggiungi altri / nuova sessione |
| `tests/entityUtils.test.ts` | nuovo | 6 test per `mergeEntities` (deduplicazione, occurrences, fileCount, sort) |
| `CHANGELOG.md` | modifica | Sezione 1.0.3 |
| `package.json` | modifica | version 1.0.2 → 1.0.3 |

## Risultati verifica

- `npm run typecheck`: zero errori TS
- `npm test`: 6/6 nuovi test `entityUtils.test.ts` passano; 39/44 totali passano (5 failure in `sessionManager.test.ts` sono pre-esistenti — usano vecchio formato pseudonimi `SOGGETTO_001` invece di iniziali `M. R.`)

## Decisioni tecniche

- **Dialog errore in DropZone**: il hook `useBatchOrchestrator` espone `errorDialog` e `resolveErrorDialog` al componente DropZone che lo usa. Il dialog è un overlay semplice senza bloccare il render.
- **Merge entità**: deduplicazione case-insensitive su `originalText`, primo pseudonimo vince (sessionManager garantisce coerenza), ordinamento per occurrences desc.
- **sendProgress retrocompatibile**: i campi `fileIndex`, `fileTotal`, `fileName` sono opzionali (`...extra`), il flusso singolo non li invia.
- **resetBatchOnly()**: preserva la sessione pseudonimi (non chiama `sessionManager.reset()`), svuota solo lo stato batch UI. "Nuova sessione" invece chiama sia `electronAPI.resetSession()` che `reset()` completo.
- **Nessuna nuova dipendenza** installata.

## Prossimi passi

- Test manuale con 3+ PDF reali
- Verificare che il flusso singolo non sia stato rotto
- Aggiornare sessione 010 test (sessionManager tests obsoleti da aggiornare in sessione futura)
