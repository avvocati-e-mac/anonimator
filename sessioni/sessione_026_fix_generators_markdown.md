# Sessione 026 — Fix DOCX/ODT/TXT generator + supporto Markdown (v1.1.0)

**Data:** 2026-03-07
**Versione:** 1.0.9 → 1.1.0

## Problema

Le entità venivano rilevate correttamente nella schermata di revisione ma non venivano sostituite nei file di output DOCX e ODT. Causa: il bug del "run-split" — in DOCX/ODT il testo visivamente continuo è spezzato in più elementi XML (`<w:t>` / `<text:span>`), il parser li concatena correttamente per il NER, ma il generator cercava la stringa nell'XML grezzo dove non esiste come sequenza contigua.

Problema secondario TXT: apostrofi tipografici (`'` U+2019) nel documento causavano mancato match se l'entità rilevata usava l'apostrofo dritto.

## Soluzione

### DOCX/ODT — approccio paragraph-by-paragraph

Per ogni paragrafo XML:
1. Estrarre tutti i segmenti di testo (`<w:t>` per DOCX, `<text:span>` + testo diretto per ODT) con i loro offset nel testo concatenato e la loro posizione nell'XML
2. Trovare le entità nel testo concatenato
3. Applicare le sostituzioni in ordine inverso (dalla fine), modificando solo i tag XML coinvolti
4. Il primo tag coinvolto riceve il pseudonimo, gli altri vengono svuotati

### TXT — normalizzazione quote

Funzione `normalizeQuotes()` applicata sia al testo del documento che al testo delle entità prima della ricerca. Converte `'`, `'`, `"`, `"`, `–`, `—` in ASCII equivalenti.

Aggiunto anche fallback encoding `latin1` se UTF-8 fallisce.

## File modificati

| File | Tipo |
|------|------|
| `src/shared/types.ts` | Aggiunta `'markdown'` a `DocumentFormat` |
| `src/main/outputGenerators/txtGenerator.ts` | Fix apostrofi + encoding fallback |
| `src/main/outputGenerators/docxGenerator.ts` | Riscrittura paragraph-by-paragraph |
| `src/main/outputGenerators/odtGenerator.ts` | Riscrittura paragraph-by-paragraph |
| `src/main/parsers/markdownParser.ts` | Nuovo — `stripMarkdown()` + `parseMarkdown()` |
| `src/main/outputGenerators/markdownGenerator.ts` | Nuovo — wrappa `replaceEntities()` da txtGenerator |
| `src/main/parsers/index.ts` | Aggiunta case `markdown`, import `parseMarkdown` |
| `src/main/outputGenerators/index.ts` | Aggiunta case `markdown`, import `generateMarkdown` |
| `src/main/ipcHandlers.ts` | Aggiunta `.md` al schema Zod |
| `package.json` | Bump 1.0.9 → 1.1.0 |
| `CHANGELOG.md` | Sezione `[1.1.0]` |

## Note tecniche

### DOCX — implementazione `processSingleParagraph`

Usa `<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>` con `matchAll` per trovare tutti i segmenti.
Svantaggio: se due segmenti hanno lo stesso testo, si usa l'indice di occorrenza per disambiguare. Questo funziona nella pratica perché testi identici in run diversi sono rari per i nomi propri.

### ODT — due tipi di segmenti

ODT ha testo sia dentro `<text:span>` che come nodo testo diretto tra tag.

**Bug 1** (scoperto durante test manuale): la regex `>([^<]+)<` non catturava il testo diretto dopo un `</text:span>` perché il branch span consumava il `>` finale. Fix: usare lookbehind/lookahead `(?<=>)([^<]+)(?=<)`.

**Bug 2**: sostituzione parziale dentro span (`"avv. Mario Rossi"` → pseudonimo dell'intero span invece che solo della sottostringa). Fix: calcolare `localStart`/`localEnd` relativi al segmento, ricostruire `before + pseudonimo + after`.

### Markdown

- `parseMarkdown()` → `stripMarkdown()` rimuove heading, bold, italic, link, liste, blockquote, codice
- `generateMarkdown()` → usa `replaceEntities()` di txtGenerator (già importato) sul file originale con sintassi intatta
- Il NER lavora sul plain text ma le parole sono le stesse → la sostituzione funziona

### NER Step 6 — fix deduplicazione (Caso A + Caso B)

**Problema**: entità singolo token ("Bianchi", "Rossi") sopravvivevano accanto a "Luca Bianchi" / "Mario Rossi" e venivano applicate come sostituzioni parziali, producendo "avv. Mario R." invece di "avv. M. R.".

**Caso B** (aggiunto): scarta entità a 1 token se è sottostringa di un'entità più lunga, a meno che appaia >2x più spesso in modo autonomo.

**Caso A** (fix): la logica "scarta l'entità lunga se ne contiene una più corta" ora richiede che la più corta abbia almeno 2 token — un singolo cognome non è mai un sostituto preferibile a nome+cognome.

File: `src/main/services/nerService.ts`

## Test

- `npm run typecheck` → 0 errori
- `npm test` → 76 test passati (5 test file)
- Test manuale DOCX/ODT/MD/TXT: DOCX 72 entità, ODT 82 entità, MD/TXT 10 entità sostituite. "Mario Rossi" e "Luca Bianchi" sostituiti correttamente in tutti i formati.

## Prossimi passi

- Valutare se il bug "D'Angiolino troncato" nei PDF è separato (è un bug del pdfGenerator, non di questo fix)
