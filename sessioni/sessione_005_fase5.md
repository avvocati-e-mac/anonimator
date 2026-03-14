# Sessione 005 — Fase 5: User Interface
**Data:** 2026-03-05
**Stato:** COMPLETATA

## File creati
- `src/renderer/src/store/sessionStore.ts` — Zustand store (AppScreen, entities, progress, error)
- `src/renderer/src/components/DropZone.tsx` — drag & drop con react-dropzone, avvia processing
- `src/renderer/src/components/ProcessingScreen.tsx` — barra progresso animata
- `src/renderer/src/components/EntityReview.tsx` — lista entità con checkbox, avvia anonimizzazione
- `src/renderer/src/components/SuccessScreen.tsx` — risultato finale con "Mostra nella cartella"
- `src/renderer/src/components/ErrorOverlay.tsx` — modale errore sopra qualsiasi schermata

## File modificati
- `src/renderer/src/App.tsx` — router tra le 4 schermate + listener progresso globale
- `src/preload/index.ts` — aggiunto `showInFolder` (apre Finder/Explorer sul file output)
- `src/renderer/src/env.d.ts` — aggiunto tipo `showInFolder` in ElectronAPI

## Flusso UI completo
1. DropZone → utente trascina file → chiama `processDocument(filePath)`
2. ProcessingScreen → barra progresso aggiornata via `onProgress`
3. EntityReview → lista entità con checkbox → utente conferma/deseleziona → `anonymizeDocument`
4. SuccessScreen → mostra path output → "Mostra nella cartella" / "Anonimizza altro"
5. ErrorOverlay → appare su qualsiasi schermata se `error != null`

## Nota: Output Generators mancanti (Fase 3-4 non completata per output)
Il backend (`ipcHandlers.ts`) per `doc:anonymize` restituisce ancora uno stub.
Gli output generator (scrittura file anonimizzato) non sono stati implementati —
verranno aggiunti come Fase 3b/4b o parte del packaging.
La UI è pronta e funzionante per il flusso completo una volta implementati.

## TypeScript: zero errori
## App: si avvia correttamente, UI visibile

## Prossimo: Fase 6
- Packaging con electron-builder (dmg per Mac, exe per Windows)
- Download tessdata ita.traineddata e modello ONNX nel build script
- Auto-update opzionale
- Output generators per PDF, DOCX, ODT, TXT (scrittura file anonimizzato)
