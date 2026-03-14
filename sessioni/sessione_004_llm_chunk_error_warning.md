# Sessione 004 — Warning UI per chunk LLM falliti silenziosamente
**Data:** 2026-03-14
**Versione:** 1.2.7

## Obiettivo
Rendere visibile all'utente quando uno o più chunk LLM falliscono silenziosamente (es. 500 Internal Server Error durante caricamento modello su LM Studio) invece di essere saltati senza avviso.

## Decisioni prese
- `detectNamesWithLlm` rimane non-throwing (robustezza invariata), ma accetta un terzo parametro opzionale `onError?: (err: unknown) => void` chiamato nel `catch`.
- `nerService.ts` passa un callback `() => { llmChunkErrors++ }` per tracciare i chunk falliti.
- Se `llmChunkErrors > 0` dopo il loop, viene aggiunto un warning localizzato in italiano (accordo grammaticale singolare/plurale).
- `llmUsed` viene settato a `true` solo se almeno un chunk è andato a buon fine (`chunks.length - llmChunkErrors > 0`).

## File modificati
- `src/main/services/llmService.ts` — aggiunto parametro `onError` opzionale a `detectNamesWithLlm`
- `src/main/services/nerService.ts` — contatore `llmChunkErrors`, warning condizionale, `llmUsed` condizionale
- `tests/llmService.test.ts` — 2 nuovi test: `onError` chiamato su 500, non chiamato su successo

## Problemi noti / TODO prossima sessione
- Nessun problema noto
- `npm run typecheck` — zero errori
- `npm test` — 145/145 test passati
