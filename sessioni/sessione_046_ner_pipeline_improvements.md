# Sessione 046 — NER Pipeline Improvements
**Data:** 2026-03-29
**Versione:** 1.4.0 (nessun bump — feature interne al Main, nessuna nuova API pubblica)

## Obiettivo
Ottimizzare la pipeline NER senza LLM: refactoring pattern regex, fix falsi positivi CF/indirizzo, veto filter ruoli processuali, co-reference resolution, score boosting cross-layer, cache chunk NER, sliding-window chunking con overlap.

## Decisioni prese

### Architetturali
- Estratte tutte le regex da `nerService.ts` a `src/main/services/regexPatterns.ts` (testabilità)
- Aggiunto campo `source?: 'regex' | 'ner' | 'llm' | 'coref' | 'boosted'` a `DetectedEntity` (opzionale, retrocompatibile)
- `applyContextualBoost` usa confronto testo invece di `score * 1.5` (score non disponibile fuori dal loop BERT senza type hack)
- Commit 2.3 (split corso) inglobato nel 2.1 per minimizzare passaggi sugli stessi file
- Parte B del Commit 3.5 (adaptive splitting header) non implementata (vedi REPORT.md §D4)
- Cache NER salva solo entità sopra soglia (le entità sotto soglia dipendono dal contesto regex → non cache-safe)

### Default conservativi
- `strictCF: false` — default lenient per compatibilità OCR
- Co-reference threshold: ≥ 2 occorrenze (non ≥ 3 — preferire meno falsi negativi)
- Sliding window overlap: 40 token (stride 360 su chunkSize 400)

## File modificati
- `src/main/services/nerService.ts` — refactoring import, flag strictCF, veto filter, co-reference, score boost, cache, sliding window
- `src/main/services/regexPatterns.ts` — **NEW** — tutte le costanti regex estratte
- `src/main/services/legalStopWords.ts` — **NEW** — Set<string> ruoli processuali
- `src/main/ipcHandlers.ts` — import clearNerChunkCache, chiamata su session:reset
- `src/shared/types.ts` — aggiunto campo `source?` a DetectedEntity
- `tests/nerRegex.test.ts` — aggiornato per importare da regexPatterns.ts, nuovi test CF strict/lenient, INDIRIZZO_CORSO
- `tests/legalStopWords.test.ts` — **NEW** — 14 test
- `tests/nerCoref.test.ts` — **NEW** — 10 test
- `tests/nerScoreBoost.test.ts` — **NEW** — 7 test
- `tests/nerChunking.test.ts` — **NEW** — 7 test
- `REPORT.md` — **NEW** — analisi completa, gap, decisioni, risultati finali

## Risultati test
- Baseline: 199 test (15 file)
- Post-sessione: 247 test (19 file, +48 nuovi)
- TypeScript strict: 0 errori
- Build: non eseguita (nessuna modifica al Renderer o ai generatori)

## Problemi noti / TODO prossima sessione
- [ ] Misurare delta latenza sliding window su documento 20+ pagine (hardware target)
- [ ] Valutare soglia co-reference ≥ 3 in base a feedback utenti (cognomi polisemici)
- [ ] INDIRIZZO_PATTERN_CORSO: verificare se il CAP è sempre presente in testi OCR
- [ ] Parte B Commit 3.5: adaptive chunking su header giuridici (bassa priorità)
- [ ] Reminder maggio 2026: sostituire `softprops/action-gh-release@v2` con `gh release create` (vedi sessione_045)
