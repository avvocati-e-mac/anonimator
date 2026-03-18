# Sessione 044 — DOCX Parser Upgrade: mammoth + Anteprima DOCX in EntityReview
**Data:** 2026-03-18
**Versione:** 1.3.2 → 1.4.0
**Branch:** feat/docx-mammoth-parser

## Obiettivo
Sostituire il parser DOCX manuale (adm-zip + fast-xml-parser) con mammoth per
l'estrazione testo, e aggiungere un pannello di anteprima HTML del documento
originale in EntityReview per i file DOCX.

---

## Decisioni architetturali prese

### 1. mammoth come motore di estrazione (non di scrittura)
`mammoth` sostituisce solo la fase di lettura. Il generatore di output
(`docxGenerator.ts`) usa ancora `adm-zip` + XML diretto per la sostituzione
run-split — approccio corretto e indipendente dal parser.
**Perché:** separazione delle responsabilità. mammoth non è adatto a modificare XML
DOCX in modo sicuro; la strategia XML inversa del generator è già corretta.

### 2. `Promise.allSettled` per testo + HTML
`extractRawText` e `convertToHtml` vengono eseguiti in parallelo.
Se solo `convertToHtml` fallisce → `previewHtml = undefined`, parsing non interrotto.
Se `extractRawText` fallisce → errore bloccante (comportamento invariato).
**Perché:** la preview è un'aggiunta opzionale — non deve mai bloccare il flusso
principale di anonimizzazione.

### 3. `previewHtml` propagato via `DocumentAnalysisResult`
Il campo viene aggiunto al tipo condiviso `DocumentAnalysisResult` come `previewHtml?: string`.
Tutti gli altri parser restituiscono `undefined` implicitamente (campo opzionale).
**Perché:** non servono nuovi canali IPC; il campo si serializza naturalmente nell'oggetto
già esistente.

### 4. Sanitizzazione HTML con whitelist interna (senza DOMPurify)
`sanitizeDocxHtml()` in `src/renderer/src/utils/docxPreview.ts` rimuove tag non in
whitelist e attributi pericolosi via regex. Estratta come utility pura per poterla
testare in ambiente `node` (vitest senza jsdom).
**Perché:** mammoth produce HTML semantico pulito, DOMPurify è una dipendenza esterna
non approvata. La whitelist manuale copre tutti i tag prodotti da mammoth.

### 5. Layout two-column con Tailwind responsive
`lg:grid lg:grid-cols-2` su schermi ≥ 1024px, pannello collassabile su mobile.
**Perché:** Tailwind-only, nessun file CSS nuovo, nessun inline style.

---

## Commit creati

| # | Hash | Messaggio |
|---|------|-----------|
| 1 | `3c9f2c8` | `chore(deps): add mammoth for DOCX text extraction` |
| 2 | `bb54a5d` | `refactor(docx-parser): replace manual XML traversal with mammoth` |
| 3 | `fc8c3b7` | `test(docx-parser): update unit tests for mammoth-based extraction` |
| 4 | `300db75` | `feat(docx-parser): add HTML preview generation alongside text extraction` |
| 5 | `3eb84bf` | `feat(ui): add DOCX preview panel in EntityReview` |
| 6 | `f1b10be` | `test(ui): add unit tests for DOCX preview sanitization logic` |
| 7 | `7a805c1` | `docs: update GUIDA.md, CLAUDE.md and CHANGELOG for v1.4.0 mammoth integration` |

---

## File modificati

- `package.json` — versione 1.3.2 → 1.4.0, aggiunta dipendenza mammoth 1.12.0
- `src/main/parsers/docxParser.ts` — riscritta con mammoth, aggiunto previewHtml
- `src/main/parsers/index.ts` — aggiunto campo `previewHtml?` a `ParseResult`
- `src/shared/types.ts` — aggiunto campo `previewHtml?` a `DocumentAnalysisResult`
- `src/main/ipcHandlers.ts` — destrutturato `previewHtml` da `extractText`, propagato nel risultato
- `src/renderer/src/components/EntityReview.tsx` — layout two-column + pannello anteprima
- `src/renderer/src/utils/docxPreview.ts` — **NUOVO**: `sanitizeDocxHtml`, `hasVisiblePreview`
- `tests/parsers.test.ts` — +5 test: run-split, tabella, heading, corrotto
- `tests/docxPreview.test.ts` — **NUOVO**: 15 test per sanitizzazione e visibilità
- `CHANGELOG.md`, `GUIDA.md`, `CLAUDE.md` — documentazione aggiornata

---

## Esito `npm run typecheck`

```
> anonimator@1.4.0 typecheck
> tsc --noEmit

(zero errori)
```

## Esito `npm test`

```
Test Files  14 passed (14)
     Tests  177 passed (177)   (+20 nuovi test: +5 parser, +15 docxPreview)
  Start at  18:45:54
  Duration  6.45s
```

---

## Sessione 044 — Fase 5 (continuazione): Fix docxGenerator multi-entità
**Data:** 2026-03-18

### Bug rilevato durante i test manuali

Il file `docxGenerator.ts` produceva output corrotto quando un paragrafo conteneva
più entità. Solo l'ultima sostituzione sopravviveva, le precedenti venivano perse.

**Root cause:** `processSingleParagraph` cercava il testo delle entità nel `xmlCursor`
già modificato dalle sostituzioni precedenti. Dopo la prima patch, le altre entità non
trovavano più il loro testo originale → silently dropped.

### Fix applicato

**Algoritmo token-based** (token = unità indivisibile di testo):
1. Scompone il paragrafo in token: `{ origStart, origEnd, text, isSubstitution }`
2. Token di sostituzione = **INDIVISIBILI**: assegnati interamente al primo `<w:t>` coinvolto
3. Token di testo letterale = **DIVISIBILI**: porzione proporzionale al range del segmento
4. Ricostruisce l'XML lavorando dall'ultimo segmento al primo (preserva gli indici)

Gestisce correttamente:
- N entità nello stesso `<w:t>` ✅
- Entità che attraversano più `<w:t>` (run-split) ✅
- Entità non confermate ignorate ✅
- Testo non-entità preservato ✅
- Caratteri XML escaped correttamente ✅

### Nuovi file

- `tests/docxGenerator.test.ts` — **NUOVO**: 10 test di regressione (sostituzione singola,
  multi-entità stesso `<w:t>`, run-split multi-entità, priorità entità lunga, entità non
  confermata, caratteri XML speciali)

### Commit aggiunto

| # | Hash | Messaggio |
|---|------|-----------|
| 8 | `b073dba` | `fix(docxGenerator): correggi sostituzione multi-entità nello stesso <w:t>` |

### Esito finale `npm test`

```
Test Files  15 passed (15)
     Tests  199 passed (199)   (+10 nuovi test docxGenerator)
  Start at  19:26:14
  Duration  6.64s
```

Comando per rieseguire:
```bash
npm test -- --reporter=verbose
```

---

## Checklist sicurezza (verificata manualmente)

- [x] Nessun `console.log(text)`, `console.log(previewHtml)`, o log di contenuto documento
- [x] `previewHtml` non loggato mai (solo `hasPreview: boolean` nel log info)
- [x] `mammoth` non fa chiamate di rete (libreria pura, nessun fetch)
- [x] `dangerouslySetInnerHTML` riceve solo HTML passato da `sanitizeDocxHtml`
- [x] Nessun `// @ts-ignore` o `as any` introdotto
- [x] Nessun `style={{...}}` nei componenti React modificati
- [x] Nessun `sendSync` IPC introdotto
- [x] `previewHtml` viene resettato implicitamente su `session:reset` (fa parte di `analysisResult` che viene resettato a `null` nell'`initialState`)

---

## Criteri di accettazione

| Criterio | Esito |
|----------|-------|
| `npm run typecheck` | ✅ zero errori |
| `npm test` | ✅ 177/177 |
| Parser DOCX con run-split | ✅ test dedicato |
| Anteprima DOCX visibile in EntityReview | ✅ (test visibilità + sanitizzazione) |
| Anteprima assente per PDF/ODT/TXT | ✅ `previewHtml` undefined su tutti gli altri parser |
| Privacy log | ✅ solo `hasPreview: boolean` nel log |

---

## TODO aperti

- [ ] **Anteprima ODT**: mammoth supporta solo DOCX. Per ODT servirebbe una soluzione
  diversa (es. conversione con LibreOffice headless o parser HTML custom).
- [ ] **Preview in BatchReview**: la feature è solo per il flusso singolo. Il batch
  gestisce N documenti — la preview per N documenti simultanei richiederebbe
  una soluzione diversa (es. preview sul file selezionato nella sidebar).
- [ ] **Testare OCR su immagini** (TODO dalla sessione 043, ancora aperto)
- [ ] **Header/footer DOCX nella preview**: mammoth non include di default il testo
  di header/footer nella conversione HTML. Non è critico per l'anteprima ma
  è una limitazione nota.

## Rischi residui

- **DOCX con macro VBA**: mammoth estrae solo il testo — le macro non vengono
  eseguite né incluse nell'HTML. Nessun rischio sicurezza.
- **DOCX cifrati (password-protected)**: mammoth lancia un'eccezione che viene
  catturata e trasformata in messaggio utente corretto.
- **DOCX con immagini embedded molto pesanti**: `convertToHtml` codifica le immagini
  in base64 inline. Per documenti con molte immagini ad alta risoluzione, `previewHtml`
  potrebbe essere molto grande (>10MB). Impatto: serializzazione IPC più lenta.
  Mitigazione futura: usare `options.convertImage` di mammoth per escludere le immagini.
- **DOCX con font custom**: la preview non includerà i font (mammoth produce HTML
  semantico senza stili CSS di font). Non è un problema per il caso d'uso (revisione
  entità, non fedeltà tipografica).
