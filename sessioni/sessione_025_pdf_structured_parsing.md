# Sessione 025 — PDF Structured Parsing (Markdown-like)

**Data:** 2026-03-07
**Branch:** `feat/pdf-structured-parsing` (da `master`)
**Versione:** nessun bump (merge in master darà 1.0.9)

## Obiettivo

Migliorare la qualità del testo estratto dai PDF per il NER, sfruttando le coordinate
già disponibili in pdfjs-dist per produrre testo strutturato Markdown-like senza nuove dipendenze.

## File modificati

- `src/main/parsers/pdfParser.ts` — unico file toccato

## Approccio implementato

### Strutture dati aggiunte

```typescript
interface LogicalLine {
  tokens: TextToken[]
  y: number          // y coordinata media della riga
  avgFontSize: number
}
```

### Funzioni aggiunte

**`groupTokensIntoLines(pageTokens: TextToken[]): LogicalLine[]`**
- Raggruppa token per coordinata Y con tolleranza ±3pt
- Ordina dall'alto in basso (y decrescente in coordinate PDF)
- Ogni riga viene ordinata per X crescente (sinistra → destra)

**`buildMarkdownPage(lines: LogicalLine[]): string`**
- Calcola fontSize mediano della pagina (esclude token < 5pt)
- ratio ≥ 1.6 → `# Titolo`
- ratio ≥ 1.3 → `## Sottotitolo`
- Gap verticale > 1.5× altezza riga tipica → riga vuota (separatore paragrafo)
- `normalizeSpacedLetters()` applicato solo alle righe non-heading
- Try/catch con fallback a testo piatto in caso di eccezione

### Modifica al flusso in `parsePdf()`

Prima: `pageTexts` costruito con concatenazione semplice dentro il loop token.
Dopo:
1. Loop su pagine raccoglie solo `allTokens[]` (invariato per output generator)
2. Post-loop: `pageTexts` costruito con `groupTokensIntoLines` + `buildMarkdownPage`

`allTokens: TextToken[]` e `pageHeights: number[]` restano **invariati** — output generator non toccato.

## Decisioni progettuali

- Tabelle (Step 3 del piano) non implementate: troppo rischio falsi positivi, beneficio marginale
- `normalizeSpacedLetters` applicato solo al testo body (non agli heading) per coerenza
- Fallback sicuro in `buildMarkdownPage`: se eccezione → testo piatto, mai crash
- `isScanned` detection usa ancora `avgCharsPerPage` sul testo finale (invariato)

## Test

- `npm run typecheck` → OK (zero errori TypeScript)
- `npm test` → 3/3 pdfParser tests OK; 5 sessionManager failures pre-esistenti (non impattati)

## Verifica qualitativa (da fare)

```bash
npm start
# Testare con:
# - PDF sentenza (intestazioni, ruoli giudiziari, nomi in maiuscolo)
# - PDF contratto (tabella delle parti)
# - PDF a doppia colonna
# - PDF scansionato (deve restare invariato — usa OCR path)
```

## Prossimi passi

- Merge `feat/ottimizzazione-prompt-llm` in master (1.0.9)
- Poi merge questo branch in master (o 1.1.0)
- Test qualitativo NER su documenti reali
