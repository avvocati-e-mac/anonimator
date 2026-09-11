# Sessione 056 — Chiarezza avanzamento OCR e anonimizzazione

**Data:** 2026-09-11  
**Versione:** 1.7.0-beta.1 (sviluppo v1.8, nessun bump)

## Obiettivo

Eliminare l'ambiguità dei messaggi di avanzamento che faceva apparire il riconoscimento OCR come eseguito sia prima sia dopo la revisione NER.

## Decisioni prese

- La pipeline resta invariata: OCR in analisi, NER e revisione, poi anonimizzazione e ricostruzione dell'output.
- La fase di anonimizzazione dichiara esplicitamente il riuso del testo OCR già presente nella cache in memoria; non viene presentata come un nuovo riconoscimento del testo.
- Il titolo condiviso dalle schermate singola e batch diventa "Elaborazione in corso", perché la stessa vista accompagna operazioni diverse.
- Il test utente ha confermato che un'entità inserita manualmente con il testo completo viene rimossa. Il primo mancato riscontro dipendeva dalla "A" finale assente nell'inserimento; resta separato il falso negativo del riconoscimento NER automatico.

## File modificati

- `src/main/services/ocrProgressMessage.ts`: testi puri per preparazione e redazione.
- `src/main/ipcHandlers.ts`: uso dei messaggi espliciti durante la generazione dell'output.
- `src/renderer/src/components/ProcessingScreen.tsx`: titolo generico della lavorazione.
- `src/renderer/src/components/BatchProcessingScreen.tsx`: stesso titolo nel flusso batch.
- `tests/anonymizationProgressMessage.test.ts`: copertura della distinzione tra OCR e anonimizzazione.
- `CHANGELOG.md`, `GUIDA.md`: comportamento documentato.

## Problemi noti / TODO prossima sessione

- Riprodurre con un campione sintetico equivalente il falso negativo NER segnalato, senza acquisire o versionare dati personali del documento usato nel test manuale.
- Nessuna modifica ai trust boundary o alla pipeline PDF fail-closed.
