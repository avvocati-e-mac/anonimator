# Sessione 007 — Integrazione LLM locale + Pseudonimi con iniziali

**Data:** 2026-03-05
**Stato:** COMPLETATA

## Obiettivo
1. Aggiungere LLM locale opzionale (Ollama / LM Studio) per rilevamento PII più accurato
2. Cambiare formato pseudonimi: da codici numerici (SOGGETTO_001) a iniziali (M. R.)
3. UI configurazione LLM con test connessione e selezione modello

## File creati
- `src/main/services/llmService.ts` — client LLM (OpenAI-compatible API), system prompt italiano, parsing risposta JSON
- `src/main/services/settingsManager.ts` — persistenza configurazione su disco (`<userData>/legalshield-settings.json`)
- `src/renderer/src/components/SettingsScreen.tsx` — schermata impostazioni con toggle, URL, dropdown modelli, test connessione

## File modificati
- `src/shared/types.ts` — aggiunto `LlmConfig`, `DEFAULT_LLM_CONFIG`, nuovi canali IPC (`SETTINGS_GET`, `SETTINGS_SET`, `LLM_TEST`, `LLM_LIST_MODELS`)
- `src/main/services/sessionManager.ts` — nuovo formato pseudonimo: iniziali per PERSONA/ORG/LUOGO (es. "M. R."), codici numerici solo per CF/IBAN/EMAIL/ecc. + `registerLlmPseudonym()`
- `src/main/services/nerService.ts` — step 3 aggiuntivo: dopo BERT chiama LLM se abilitato; aggiunta `splitTextIntoLlmChunks()`; firma `analyzeText(text, llmConfig?)`; aggiunto `llmUsed` nel risultato
- `src/main/ipcHandlers.ts` — handler per `SETTINGS_GET`, `SETTINGS_SET`, `LLM_TEST`, `LLM_LIST_MODELS`; passa `llmConfig` a `analyzeText()`
- `src/preload/index.ts` — espone `getSettings`, `setSettings`, `testLlm`, `listLlmModels`
- `src/renderer/src/env.d.ts` — tipi aggiornati per nuove API
- `src/renderer/src/App.tsx` — aggiunto stato `showSettings`, renderizza `SettingsScreen`
- `src/renderer/src/components/DropZone.tsx` — aggiunto bottone impostazioni (⚙) in alto a destra

## Architettura LLM

### Flusso rilevamento (nerService.ts)
1. Regex (CF, IBAN, email, tel, P.IVA) — sempre
2. BERT NER locale (Transformers.js) — se modello disponibile
3. LLM locale (se abilitato e configurato) — chiamate in chunk da 3000 char
4. Cerca varianti maiuscole delle entità trovate

### Pseudonimi
- PERSONA / ORGANIZZAZIONE / LUOGO: `toInitials()` → "Filippo Strozzi" → "F. S.", "Studio Legale Strozzi" → "S. L. S."
- Se LLM: usa il testo di sostituzione fornito dall'LLM direttamente (già in formato iniziali)
- CODICE_FISCALE / IBAN / EMAIL / TELEFONO / PARTITA_IVA: codici numerici (CF_001, IBAN_001, ecc.)
- Conflitti iniziali: disambiguazione con suffisso "(2)", "(3)" ecc.

### LLM Service
- Endpoint: `POST /chat/completions` (OpenAI-compatible)
- Supporta: Ollama (`:11434/v1`), LM Studio (`:1234/v1`), qualsiasi server compatibile
- System prompt: descrive regole italiane, formato iniziali, cosa NON anonimizzare
- Parsing: estrae primo array JSON dalla risposta; filtra stopword italiane
- Timeout configurabile (default 60s); abort via AbortController (no setTimeout loop)
- `listLlmModels()`: `GET /models` → dropdown in UI

## Configurazione salvata
Path: `~/Library/Application Support/LegalShield/legalshield-settings.json`
```json
{
  "llm": {
    "enabled": true,
    "baseUrl": "http://localhost:11434/v1",
    "model": "llama3.2",
    "maxTokens": 8192,
    "timeoutMs": 60000
  }
}
```

## Stato TypeScript
- Zero errori (`npx tsc --noEmit`)

## Prossimi passi
1. Testare flusso completo con Ollama locale (modello llama3.2 o gemma3)
2. Verificare che "Filippo Strozzi", "Matteo Menozzi" vengano rilevati dall'LLM
3. Verificare formato pseudonimi nel PDF output (M. R. invece di SOGGETTO_001)
4. Fase 6: packaging electron-builder (dmg Mac, exe Windows)
