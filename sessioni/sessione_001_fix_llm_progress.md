# Sessione 001 — Fix progress LLM, rimozione chunkMode, prompt NER ottimizzato, fallback Phi 3B
**Data:** 2026-03-14
**Versione:** 1.2.7

## Obiettivo

1. Correggere il messaggio di progresso LLM (mostrava chunk invece di pagine reali per PDF,
   usava "sezione" anche per TXT/DOCX/ODT/MD)
2. Rimuovere il toggle `chunkMode` dalla UI e dal tipo `LlmConfig` (ridondante)
3. Aggiornare il prompt NER di default per compatibilità con modelli 3B
4. Fix fallback per modelli che non supportano `response_format` (Phi 3B)

## Analisi

### Flusso onLlmProgress (baseline)
```
nerService.analyzeText()
  → loop LLM: completed++ per ogni chunk processato
  → onLlmProgress(completed, chunks.length)   ← contava CHUNK, non pagine
    → ipcHandlers.ts callback
      → sendProgress('ner', pct, `Analisi LLM: sezione ${page}/${total}...`)
        → mainWindow.webContents.send('doc:progress', { stage, percent, message })
          → sessionStore.setProgress(percent, message)
            → ProcessingScreen.tsx mostra progressMessage (stringa as-is)
```

### Root cause progresso
`format` e `pageCount` erano disponibili nel closure di `ipcHandlers.ts` ma
non venivano usati per costruire il messaggio. Fix: closure su `format` e `pageCount`.

### Root cause chunkMode
`chunkMode` in `LlmConfig` era dead UI: la page-mode si attiva automaticamente
quando `pages && pages.length > 0` — non serve una preferenza utente.

### Root cause errori Phi 3B
Phi 3B non supporta né `json_schema` né `json_object` nel campo `response_format`.
Il codice faceva 2 tentativi; il secondo 400 veniva rilanciato come errore.
Fix: terzo tentativo senza `response_format` (plain chat + parsing best-effort).

## Decisioni prese

- Il messaggio di progresso è costruito in `ipcHandlers.ts` (non nel renderer):
  architettura già esistente, nessun cambio di interfaccia IPC necessario.
- `chunkMode` rimosso da `LlmConfig`, `DEFAULT_LLM_CONFIG`, `LlmConfigSchema` Zod,
  `nerService.ts`, `SettingsScreen.tsx`. La page-mode si attiva da `pages !== undefined`.
- Prompt NER unificato (una sola costante `OPTIMIZED_NER_PROMPT` per IT e EN):
  l'inglese funziona meglio su modelli piccoli multilingua.
- Fallback a 3 livelli in `OpenAiCompatAdapter`:
  1. `json_schema` → 2. `json_object` → 3. plain chat senza `response_format`

## File modificati

- `src/main/ipcHandlers.ts` — messaggio progresso formato-aware + rimozione chunkMode da Zod
- `src/main/services/nerService.ts` — sostituisce `chunkMode` con `usePageMode` automatico
- `src/main/services/llmService.ts` — prompt NER ottimizzato (~35% più corto)
- `src/main/services/llm/providers/OpenAiCompatAdapter.ts` — terzo tentativo plain chat
- `src/shared/types.ts` — rimozione `chunkMode` da `LlmConfig` e `DEFAULT_LLM_CONFIG`
- `src/renderer/src/components/SettingsScreen.tsx` — rimozione toggle "Modalità analisi AI"
- `tests/nerPageMode.test.ts` — aggiornato per rimozione chunkMode
- `tests/llmService.test.ts` — rimosso chunkMode da mockConfig
- `tests/openAiCompatAdapter.test.ts` — aggiunto test terzo tentativo plain chat

## Commit di questa sessione

| Hash | Descrizione |
|------|-------------|
| `3eb9717` | fix(ipcHandlers): pagina X/Y per PDF, chunk X di N per altri formati |
| `d9a0f5a` | refactor(types): rimuove chunkMode da LlmConfig e DEFAULT_LLM_CONFIG |
| `587f170` | fix(nerService,ipcHandlers): usePageMode automatico, rimuove schema Zod chunkMode |
| `9ae1783` | refactor(settings): rimuove toggle chunkMode da SettingsScreen |
| `d992877` | fix(llmService): prompt NER ottimizzato per modelli 3B |
| `811e308` | fix(OpenAiCompatAdapter): terzo tentativo senza response_format per Phi 3B |

## Stato finale

- `npm test` → 123 test ✓
- `npm run typecheck` → zero errori
- Branch: `feat/llm-provider-adapters-structured-output` (13 commit ahead di master)
- PR #17 aperta

## Comportamento UI aggiornato

- PDF 13 pagine → `"Analisi LLM: pagina 2/13..."`
- TXT/DOCX/ODT/MD → `"Analisi LLM: chunk 2 di 4..."`
- Toggle "Modalità analisi AI" rimosso dalle impostazioni avanzate

## Problemi noti / TODO prossima sessione

- **500 intermittenti su chunk specifici (Phi 3B):** già gestiti con fallback a `[]`,
  ma potrebbero indicare testo troppo lungo o caratteri non gestiti dal modello.
  Possibile fix futuro: troncare chunk a `min(chunkSize, maxTokens * 3)` caratteri.
- **Formati immagine (OCR):** nessun contatore LLM mostrato — comportamento accettabile,
  da rivalutare se si aggiunge supporto LLM post-OCR.
- **`ARUBAPEC` ancora nel fallback di `isValidReplacement`:** il prompt nuovo usa
  `ACMEPEC` come esempio — verificare che i modelli non confondano nome di esempio
  con entità reale nei log.
- **Merge in master:** PR #17 pronta per review e merge.
