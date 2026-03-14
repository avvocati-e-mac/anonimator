# Sessione 002 — Fase 2: NER Engine + SessionManager
**Data:** 2026-03-05
**Stato:** COMPLETATA (in attesa modello ONNX)

## Cosa è stato fatto

### File creati
- `src/main/services/sessionManager.ts` — dizionario pseudonimi in memoria (singleton)
- `src/main/services/nerService.ts` — motore NER ibrido (regex + Transformers.js)
- `src/main/parsers/index.ts` — stub parser (verrà implementato Fase 3)
- `tests/sessionManager.test.ts` — 7 test unitari
- `tests/nerRegex.test.ts` — 10 test unitari sui pattern regex
- `vitest.config.ts` — configurazione vitest con alias @shared
- `sessioni/sessione_001_fase1.md` — log sessione precedente
- `CLAUDE.md` — aggiornato con Gemini CLI workflow e riferimento sessioni

### File modificati
- `src/main/ipcHandlers.ts` — collegato a nerService e sessionManager reali
- `src/shared/types.ts` — aggiunto tipo DocumentFormat

## Scoperte tecniche (API Transformers.js v3)

**Nota su Gemini CLI:** Gemini ha suggerito `aggregation_strategy: 'simple'` e il campo `entity_group`.
Verificato empiricamente: questa opzione NON esiste in @huggingface/transformers v3.3.3 (la versione installata).
Né nei type definitions né nel bundle compilato (`transformers.node.cjs`). Gemini basava la risposta
su documentazione online che descrive una versione diversa. La verifica diretta sul codice installato
è sempre necessaria prima di fidarsi delle risposte di Gemini su API specifiche.

Investigata via ispezione diretta dei type definitions in node_modules:

- `aggregation_strategy` NON esiste come opzione di `pipeline()` in @huggingface/transformers v3
  → l'aggregazione BIO deve essere fatta manualmente (funzione `aggregateBioTokens`)
- Il campo si chiama `entity` (non `entity_group` come in Python)
- `TokenClassificationPipelineType` genera union type troppo complessa per TypeScript strict
  → soluzione: tipo funzionale custom `NerPipelineFn` + cast `as unknown as NerPipelineFn`
- Output: array `TokenClassificationSingle[]` con campi: `word`, `entity`, `score`, `start`, `end`
- Le etichette seguono schema BIO: "B-PER", "I-PER", "B-ORG" ecc.

## Modello ONNX: da scaricare prima dell'uso

Il modello `DeepMount00/Italian_NER_XXL_v2` deve essere convertito in formato ONNX
e copiato in `resources/models/italian-ner-xxl-v2/`.

Procedura (da fare una tantum, fuori dal codice dell'app):
```bash
pip install optimum[exporters] transformers
optimum-cli export onnx --model DeepMount00/Italian_NER_XXL_v2 resources/models/italian-ner-xxl-v2/
```

Se il modello non è presente, nerService fa graceful fallback a sole regex
(vedi `modelLoadFailed` flag e `warnings` nell'output).

## Test
- 17/17 test passati
- TypeScript: zero errori (strict mode)

## Prossimo: Fase 3
- Parser TXT: legge file di testo UTF-8 (semplice)
- Parser DOCX: unzip + parsing XML con fast-xml-parser, estrae testo dai nodi `<w:t>`
- Parser ODT: unzip + parsing XML content.xml, estrae testo dai nodi `<text:p>`
- Aggiornare `src/main/parsers/index.ts` con implementazione reale
