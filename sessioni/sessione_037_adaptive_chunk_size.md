# Sessione 037 — chunkSize adattivo in base alla taglia del modello
**Data:** 2026-03-14
**Versione:** 1.2.7

## Obiettivo
Risolvere gli errori HTTP 400 su modelli 3B causati dal context window overflow. Il terzo tentativo in `OpenAiCompatAdapter` (plain chat senza `response_format`) falliva perché il chunk di 3000 char + system prompt (~1200 char) superava il context window dei modelli piccoli.

## Decisioni prese
- `inferChunkSize` collocata in `src/shared/modelSizeUtils.ts` (non in `src/main/`) per renderla usabile anche dal renderer (tooltip UI) senza IPC overhead
- Logica di rilevamento: regex sul nome del modello, separatore obbligatorio prima del numero per evitare falsi match (es. `13b` non deve matchare `3b`)
  - ≤4B (1b/2b/3b/4b via separatore, oppure mini/small/tiny): 1200 char
  - 7-8B: 2000 char
  - Default / ambiguo: 3000 char
- Il chunkSize manuale dell'utente viene rispettato se diverso dal default (3000)
- Tooltip in `SettingsScreen`: visibile solo per modelli ≤4B (1200) o 7-8B (2000), colore amber per distinguersi

## File modificati
- `src/shared/modelSizeUtils.ts` — nuovo, `inferChunkSize(modelName): number`
- `src/main/services/nerService.ts` — riga ~449: usa `inferChunkSize` con fallback al valore manuale
- `src/renderer/src/components/SettingsScreen.tsx` — tooltip sotto campo modello
- `tests/modelSizeUtils.test.ts` — nuovo, 16 test case

## Problemi noti / TODO prossima sessione
- Nessun problema noto
- Il fix per il regex `llama3.1:13b` (separatore obbligatorio) è stato necessario perché il pattern originale `[:\-_]?` (zero o uno) matchava `3b` dentro `13b`
