# Sessione 038 — Fix context overflow LM Studio + cap parallelRequests ≤4B
**Data:** 2026-03-14
**Versione:** 1.2.7

## Obiettivo
Risolvere gli errori 400 persistenti su LM Studio con Phi-3 mini causati da context overflow sulla KV cache condivisa tra slot paralleli, non dal formato risposta.

## Decisioni prese
- **Causa radice:** LM Studio con `n_parallel=4` divide la KV cache di 4096 token equamente. Due richieste parallele da ~2000 token ciascuno superano i 4096 disponibili → `Context size has been exceeded` → 400.
- **Fix retry logic:** `isContextOverflow()` legge il body del 400 prima di ogni retry. Se contiene pattern di overflow (`context.size.has.been.exceeded`, `context_length_exceeded`, `maximum.context.length`, `prompt.is.too.long`) lancia subito l'errore senza ulteriori tentativi.
- **Cap parallelRequests:** per modelli ≤4B (`inferChunkSize(model) === 1200`), `effectiveParallel` viene forzato a 1 nel main process indipendentemente dall'impostazione utente. Log warn se l'utente aveva impostato > 1.
- **Avviso amber UI:** appare in SettingsScreen sotto lo slider "Velocità analisi" solo se modello ≤4B E parallelRequests ≥ 2. Informa che il cap è automatico.

## File modificati
- `src/main/services/llm/providers/OpenAiCompatAdapter.ts` — metodo privato `isContextOverflow()`, bail immediato prima del tentativo 2 e 3
- `src/main/services/nerService.ts` — `effectiveParallel = isSmallModel ? 1 : parallelRequests`, log warn
- `src/renderer/src/components/SettingsScreen.tsx` — avviso amber condizionale sotto slider parallelRequests
- `tests/openAiCompatAdapter.test.ts` — aggiornati mock 400 con `clone()`/`text()`, aggiunti 4 test context overflow

## Problemi noti / TODO prossima sessione
- Nessun problema noto
- I mock 400 nei test esistenti ora usano `make400Response()` con `clone()`/`text()` per supportare `isContextOverflow()`
