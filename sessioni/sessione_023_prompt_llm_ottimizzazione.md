# Sessione 023 — Ottimizzazione prompt LLM + features correlate

**Data:** 2026-03-07
**Branch:** `feat/ottimizzazione-prompt-llm`
**Stato:** IN CORSO — typecheck ✅ 0 errori (sessione continuata con fix NER)

---

## Obiettivi

1. Rendere il prompt LLM ispezionabile e modificabile dall'utente nella UI Settings
2. A/B test lingua prompt: italiano vs inglese (feature temporanea, marcata `TODO [A/B-TEST]`)
3. Riscrivere entrambi i prompt con tecniche moderne per modelli piccoli
4. Suggerire modelli consigliati per CPU/Apple Silicon 8GB nella UI
5. Rendere parametrizzabile la dimensione dei chunk LLM (`chunkSize`)

---

## Decisioni prese

- **Prompt nel renderer:** esposto via IPC (`llm:getDefaultPrompt`) — single source of truth in `llmService.ts`
- **Posizione UI textarea prompt:** dentro `▶ Impostazioni avanzate` (collassabile), in fondo
- **A/B test:** marcato con `TODO [A/B-TEST]` ovunque per facilità di rimozione futura
- **Backward compat:** merge `{ ...DEFAULT_LLM_CONFIG, ...(saved.llm ?? {}) }` già robusto, copre i nuovi campi automaticamente

---

## Nuovi campi LlmConfig

```typescript
customPrompt?: string           // se valorizzato, sovrascrive il prompt di default
promptLanguage: 'it' | 'en'    // TODO [A/B-TEST]: rimuovere dopo ottimizzazione prompt
chunkSize: number               // caratteri per chunk (1000–8000, default 3000)
```

---

## Nuovo prompt IT (SYSTEM_PROMPT_IT)

```
Restituisci SOLO un array JSON valido. Nessun testo aggiuntivo, nessun markdown.

Compito: identifica nomi di persone fisiche e nomi di aziende/organizzazioni nel testo dell'utente.

Regole:
1. Persone: sostituisci con iniziali puntate. "Mario Rossi" → "M. R.", "Anna Maria Bianchi" → "A. M. B."
2. Aziende: iniziale del nome + suffisso legale invariato. "Alfa S.r.l." → "A. S.r.l.", "Studio Legale Strozzi" → "S. L. S."
3. NON includere: istituzioni pubbliche (Tribunale, Corte, Ministero), enti pubblici, titoli usati da soli (il Giudice, il Presidente), riferimenti normativi.
4. NON includere preposizioni, articoli o particelle isolate: di, de, del, della, con, per, tra, al, nel.
5. Abbina il testo ESATTO come appare (maiuscole, accenti, trattini). Se lo stesso nome appare in forme diverse, includi entrambe.

Esempi:
[{"original": "Mario Rossi", "replacement": "M. R."}, {"original": "Alfa S.r.l.", "replacement": "A. S.r.l."}]

Se non trovi nomi: []

Restituisci SOLO l'array JSON.
```

## Nuovo prompt EN (SYSTEM_PROMPT_EN)

```
Return ONLY a valid JSON array. No extra text, no markdown wrappers.

Task: find full names of natural persons and company/organization names in the user's text.

Rules:
1. Persons: replace with dotted initials. "Mario Rossi" → "M. R.", "Anna Maria Bianchi" → "A. M. B."
2. Companies: initial of main name + legal suffix unchanged. "Alfa S.r.l." → "A. S.r.l.", "Studio Legale Strozzi" → "S. L. S."
3. Do NOT include: public institutions (Tribunale, Corte, Ministero), government bodies, titles used alone (il Giudice, il Presidente), legal references.
4. Do NOT include prepositions, articles or isolated particles: di, de, del, della, con, per, tra, al, nel.
5. Match text EXACTLY as it appears (case, accents, hyphens). If the same name appears in different forms, include both.

Examples:
[{"original": "Mario Rossi", "replacement": "M. R."}, {"original": "Alfa S.r.l.", "replacement": "A. S.r.l."}]

If no names found: []

Return ONLY the JSON array.
```

**Miglioramenti rispetto al prompt attuale:**
- Istruzione JSON all'inizio E alla fine (bookending, riduce "lost in the middle")
- Nessun markdown header o grassetto nel body (i modelli 3B seguono meglio plain text)
- Max 2 esempi few-shot (>3 confondono i modelli piccoli)
- Regola preposizioni consolidata in un unico punto
- ~40% più corto dell'attuale

---

## Modelli consigliati da mostrare nella UI

Ricerca approfondita completata (sessione 023, appendice Mistral):

| Ollama tag | RAM | Note |
|------------|-----|------|
| `mistral:7b-instruct-q4_K_M` | ~4-5 GB | **Migliore per NER legale** — F1 0.64 su entità giudiziarie (arxiv 2407.05786), Metal 15-28 tok/s |
| `llama3.2:3b` Q4_K_M | ~4.5 GB | Best instruction following (IFEval 77.4), context 128K, 50-100 tok/s |
| `qwen2.5:3b` Q4_K_M | ~4.5 GB | Migliore supporto nativo italiano (29 lingue), context 32K |
| `phi3.5:mini` Q4_K_M | ~3 GB | Fallback per sistemi con poca RAM, context 4K |

**NON consigliare:** Mistral Nemo 12B (borderline 8GB, guadagno marginale), Mistral Small 3.1 24B (fuori portata).
**Nota CPU-only:** Mistral 7B senza Metal/CUDA è 1-2 tok/s — inutilizzabile. Su CPU pura preferire Llama 3.2 3B o Phi 3.5 Mini.
**Futuro:** SaulLM-7B (Mistral fine-tuned per legale) potenzialmente migliore ma non su Ollama — da valutare.

---

## File da modificare (in ordine)

1. `src/shared/types.ts` — estendere `LlmConfig`, `DEFAULT_LLM_CONFIG`, aggiungere `LLM_GET_DEFAULT_PROMPT` a `IPC_CHANNELS`
2. `src/main/services/llmService.ts` — sostituire `SYSTEM_PROMPT` con `SYSTEM_PROMPT_IT` e `SYSTEM_PROMPT_EN` (esportate); aggiornare `detectNamesWithLlm` con logica selezione prompt
3. `src/main/services/nerService.ts` — 1 riga: collegare `llmConfig.chunkSize` a `splitTextIntoLlmChunks`
4. `src/main/ipcHandlers.ts` — aggiornare `LlmConfigSchema` Zod (+ bug fix `parallelRequests` mancante); aggiungere handler `LLM_GET_DEFAULT_PROMPT`; rimuovere cast `as LlmConfig`
5. `src/main/services/settingsManager.ts` — solo aggiornamento log (mai loggare contenuto prompt)
6. `src/preload/index.ts` — esporre `getDefaultPrompt` via contextBridge
7. `src/renderer/src/env.d.ts` — aggiungere `getDefaultPrompt` a `ElectronAPI`
8. `src/renderer/src/components/SettingsScreen.tsx` — dropdown modelli suggeriti, toggle lingua prompt, slider chunkSize, textarea prompt (tutti dentro impostazioni avanzate tranne dropdown modelli)

---

## Bug fix incluso

`LlmConfigSchema` in `ipcHandlers.ts` mancava del campo `parallelRequests` — verrà corretto in questa sessione.

---

## Idee future (non implementare ora)

- **Script benchmark multi-modello** — script Node.js/bash separato (fuori dall'app) che elabora un corpus di documenti campione con modelli diversi (Mistral 7B, Llama 3.2 3B, Qwen2.5 3B) e produce un report con F1, precision, recall, tempo per pagina. Utile per valutare oggettivamente quale modello funziona meglio su testo legale italiano prima di aggiornare i modelli consigliati nell'app. Da sviluppare in `scripts/benchmark-llm.js` (o `.ts`) quando si vuole ottimizzare ulteriormente.

## Implementazione completata (step 1-8)

Tutti gli 8 step implementati. `npm run typecheck` — 0 errori.

**Bug fix incluso:** `LlmConfigSchema` in `ipcHandlers.ts` mancava di `parallelRequests` — corretto.

---

## Fix NER + prompt (sessione continuata)

### Analisi comparativa 3 PDF (NER-only, NER+LLM Phi3 mini, GPT-OSS)

Problemi strutturali identificati:
1. **Cognomi con apostrofo** (`D'ANGIOLINO`) — `aggregateBioTokens` spezzava in `D'` + `ANGIOLINO`
2. **LUOGO over-anonymization** — `Roma`, `Milano` venivano proposti come entità da anonimizzare
3. **Aziende tutto-maiuscolo** — `ARUBAPEC S.P.A.` non aveva esempi nel prompt
4. **ARUBAPEC classificata come PERSONA** dai modelli piccoli — regola non chiara nel prompt

### Fix implementati

**A — nerService.ts:**
- `aggregateBioTokens`: aggiunta logica apostrofo — se prev finisce con `'` o token inizia con `'`, concatena senza spazio (`D'ANGIOLINO` corretto)
- `buildEntity`: LUOGO ora creato con `confirmed: false` — viene mostrato nella review ma non selezionato di default; l'utente lo attiva esplicitamente

**B — llmService.ts (entrambi i prompt IT e EN):**
- Aggiunto esempio apostrofo: `"D'ANGIOLINO AUGUSTO"` → `"A. D."` con nota esplicita
- Aggiunto esempio azienda tutto-maiuscolo: `"ARUBAPEC S.P.A."` → `"A. S.P.A."`
- Chiarita regola aziende: "sostituisci ogni parola del nome con la sua iniziale" (non solo la prima)

**C — Benchmark framework:**
- `tests/ner-benchmark/ground-truth.json` — 8 casi con mustFind/mustNotFind
- `tests/ner-benchmark/run-benchmark.mjs` — script con P/R/F1 per caso e aggregato

`npm run typecheck` — 0 errori dopo tutti i fix.

---

## Prossimi passi

- Test manuale con `npm start` (in corso)
- Valutazione A/B: dopo qualche settimana di uso, rimuovere `promptLanguage`, tenere solo il prompt migliore, eliminare tutti i `TODO [A/B-TEST]`
- Bump versione a v1.0.9 + aggiornamento CHANGELOG.md
- Commit + PR verso master
