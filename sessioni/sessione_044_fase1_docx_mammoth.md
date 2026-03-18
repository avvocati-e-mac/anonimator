# Sessione 044 — Fase 1: Analisi DOCX Mammoth (READ-ONLY)
**Data:** 2026-03-18
**Versione:** 1.3.2 → target 1.4.0
**Branch:** feat/docx-mammoth-parser

## Obiettivo
Analisi completa del codice esistente prima di introdurre mammoth come motore
di estrazione testo per i file DOCX. Nessuna modifica al codice in questa fase.

---

## 1.1 — Analisi `docxParser.ts`

### Flusso completo

1. **`adm-zip`** apre il file `.docx` come archivio ZIP ed estrae `word/document.xml`.
2. **`fast-xml-parser`** (con `ignoreAttributes: false`, `attributeNamePrefix: '@_'`,
   `isArray` su `w:p`, `w:r`, `w:t`, ecc.) effettua il parse XML → oggetto JS.
3. Il corpo del documento viene letto da `parsed['w:document']['w:body']`.
4. `extractParagraphsFromNode(body, paragraphs)` naviga ricorsivamente il nodo:
   - Se il nodo è un array → itera.
   - Se il nodo contiene `w:r` o `w:t` → è un paragrafo, chiama `extractTextFromParagraph`.
   - Altrimenti → scende sulle chiavi che iniziano con `w:` (gestisce tabelle `w:tbl`,
     `w:tr`, `w:tc` ricorsivamente).
5. `extractTextFromParagraph` raccoglie tutti i `w:r` del paragrafo → per ognuno legge
   `w:t` (che può essere stringa, oggetto `{#text, @_xml:space}`, o array) →
   concatena in `runs.join('')`.
6. Il testo finale è `paragraphs.join('\n')` (dopo trim e filter vuoti).
7. Il conteggio pagine viene stimato contando `w:type="page"` nel XML grezzo + 1.

### Path di navigazione XML gestiti

| Path XML | Gestito? |
|----------|----------|
| `w:body > w:p` (paragrafi standard) | ✅ sì |
| `w:body > w:tbl > w:tr > w:tc > w:p` (tabelle) | ✅ sì (ricorsione) |
| `w:p` annidati (heading, liste) | ✅ sì (ricorsione su chiavi `w:`) |
| `w:hdr` / `w:ftr` (header/footer) | ❌ no (file separati `word/header1.xml`, non aperti) |

### Comportamento sul run-split

Il parser **concatena** correttamente tutti i `w:r` di un paragrafo. Se `MARIO ROSSI`
è spezzato in `<w:t>MAR</w:t>...<w:t>IO ROSSI</w:t>`, il risultato sarà `MARIO ROSSI`.
**Tuttavia** la logica è fragile nei casi seguenti:

### Strutture DOCX non gestite

| Struttura | Descrizione | Impatto |
|-----------|-------------|---------|
| `w:ins` / `w:del` | Tracked changes (revisioni) | Il testo inserito/eliminato non viene estratto |
| `w:sdt` / `w:sdtContent` | Content controls (campi strutturati, form) | Il testo dei campi non viene estratto |
| `w:hyperlink` | Hyperlink con testo | Il testo del link potrebbe essere perso se non wrapped in `w:r` |
| `w:hdr` / `w:ftr` | Header e footer (file separati) | Testo in header/footer non estratto |
| `w:drawing` / `w:object` | Immagini e oggetti embedded | Nessun testo alternativo estratto |
| `w:fldChar` / `w:instrText` | Campi formula/numeri pagina | Testo istruzione appare invece del valore |
| Footnote/endnote (`word/footnotes.xml`) | Note a piè di pagina | Non estratte |

### Test esistenti (in `tests/parsers.test.ts`)

4 test:
- Estrae testo dal fixture `sample.docx` (controlla `Mario Rossi`, CF, IBAN)
- `pageCount >= 1`
- Testo non vuoto
- Lancia errore su file non DOCX (es. `sample.txt`)

---

## 1.2 — Analisi `docxGenerator.ts`

### Gestione run-split in scrittura

`processSingleParagraph()` implementa una strategia corretta:
1. `extractTextSegments()` usa regex `/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g` per trovare
   tutti i tag `w:t` con le loro posizioni nel XML e nel testo concatenato.
2. `findReplacements()` cerca le entità nel testo concatenato (con normalizzazione quote).
3. Per ogni sostituzione, trova i segmenti `w:t` coinvolti e li modifica **dall'ultimo
   al primo**: il primo tag coinvolto riceve il pseudonimo, gli altri vengono svuotati.
4. Usa `occurrenceIndex` per distinguere tag con lo stesso testo.

Questo approccio è **indipendente** dal parser: legge `word/document.xml` direttamente
dallo ZIP originale, non usa il testo estratto da `docxParser.ts`.

### Verifica `escapeXml`/`unescapeXml`

Coprono i 5 caratteri obbligatori XML: `& < > " '`. **Non coprono** caratteri come
`\u00A0` (non-breaking space) o caratteri di controllo, ma questi non causano problemi
in pratica per documenti legali italiani.

### Casi limite noti o non testati

- DOCX con tabelle annidate profonde: la regex `/<w:p[ >][\s\S]*?<\/w:p>/g` in
  `processParagraphs()` potrebbe non matchare paragrafi in alcune strutture.
- DOCX con `w:r` contenenti solo `w:rPr` (formattazione senza testo): gestiti
  correttamente perché `w:t` è undefined e vengono saltati.
- Non ci sono test diretti per `docxGenerator.ts` nei file `tests/`.

---

## 1.3 — Analisi `ipcHandlers.ts` e `types.ts`

### Campi di `DocumentAnalysisResult` (inviati al Renderer via `doc:process`)

```typescript
interface DocumentAnalysisResult {
  fileName: string       // nome file (senza path)
  format: DocumentFormat // 'pdf'|'docx'|'odt'|'txt'|'image'|'markdown'
  pageCount: number
  entities: DetectedEntity[]
  warnings: string[]
  isScanned?: boolean
}
```

**Non esiste** nessun campo per HTML/preview. Il tipo è in `src/shared/types.ts` riga 73.

### Punto di iniezione per `previewHtml`

In `ipcHandlers.ts`, l'handler `doc:process` (riga 86-146):
- Riga 103: `extractText(filePath, format)` → restituisce `{ text, pageCount, warnings, isScanned }`
- Riga 133-140: costruisce e restituisce l'oggetto risultato

**Punto di iniezione corretto:** dopo `extractText()`, nel blocco `return { ... }` a riga 133.
`previewHtml` dovrà essere generato dentro `parseDocx()` e propagato attraverso
`ParseResult` → `extractText()` → handler IPC → `DocumentAnalysisResult`.

### Schema Zod da aggiornare

Il `ProcessDocumentSchema` (riga 23-34) valida solo l'input. La risposta non è
validata da Zod — è costruita direttamente. Non serve modificare lo schema di input.
Il campo `previewHtml` andrà aggiunto solo al tipo TypeScript `DocumentAnalysisResult`.

---

## 1.4 — Analisi `EntityReview.tsx` e `sessionStore.ts`

### Struttura visiva di `EntityReview.tsx`

```
<div min-h-screen flex flex-col>
  <header>                    ← fisso in alto, logo + nome file
  <main flex-1 overflow-y-auto>
    <div max-w-2xl mx-auto>
      [Mini dropzone]         ← visibile solo su sessione ripristinata
      [Titolo + contatori]
      [Warnings collassabili]
      [Lista EntityRow]       ← una per entità
      [Spacer h-4]
  <footer>                    ← fisso in basso, pulsanti azione
  [AddEntityModal]            ← overlay modale
```

Layout attuale: **colonna singola**, `max-w-2xl mx-auto`. Per aggiungere il pannello
anteprima su schermi ≥ 1024px servirà un wrapper `lg:grid lg:grid-cols-2 lg:gap-4`
attorno a lista entità e pannello anteprima (senza toccare header/footer fissi).

### Campo store per il risultato `doc:process`

`analysisResult: DocumentAnalysisResult | null` — campo in `SessionState` (riga 37).
Il valore viene impostato da `setAnalysisResult(result)` (riga 116):
```typescript
setAnalysisResult: (result) => set({ analysisResult: result, entities: result.entities }),
```

**Non esiste** un campo separato per `previewHtml`. Poiché `previewHtml` fa parte di
`DocumentAnalysisResult`, sarà automaticamente disponibile come
`analysisResult?.previewHtml` senza modificare lo store — il campo viene incluso
nell'oggetto `analysisResult` già esistente. **Nessuna modifica allo store necessaria**
(il campo opzionale su `DocumentAnalysisResult` è già disponibile via `analysisResult`).

### Impatto visivo del pannello anteprima

- Su schermi ≥ 1024px: layout a due colonne. Colonna sinistra: lista entità (attuale
  `max-w-2xl` diventa metà schermo). Colonna destra: pannello anteprima con
  `max-h-[70vh] overflow-y-auto`.
- Su schermi < 1024px: pannello collassabile con toggle "Mostra/Nascondi anteprima"
  sopra la lista entità.
- Il pannello è **condizionale**: appare solo se `analysisResult?.previewHtml` è
  una stringa non vuota. Nessuna regressione per PDF/ODT/TXT/immagini.

---

## 1.5 — Verifica disponibilità `mammoth`

| Voce | Stato |
|------|-------|
| In `package.json` (dependencies) | ❌ assente |
| In `package.json` (devDependencies) | ❌ assente |
| Versione npm attuale | `1.12.0` |
| Licenza | **BSD-2-Clause** (compatibile MIT del progetto) |
| Tipi TypeScript | ✅ integrati in `lib/index.d.ts` (nessun `@types/mammoth` necessario) |
| `@types/mammoth` su npm | ❌ non disponibile |

**Nota licenza:** BSD-2-Clause è una licenza permissiva. Non introduce vincoli
copyleft. La licenza MIT del progetto Anonimator rimane invariata.

---

## Stato iniziale verificato

```
npm run typecheck  → 0 errori ✅
npm test           → 157/157 passati ✅
git status         → repository pulito ✅
branch corrente    → feat/docx-mammoth-parser ✅
```

---

## Prossimi passi (Fase 2)

1. `npm install mammoth` (Commit 1)
2. Refactor `docxParser.ts` con mammoth (Commit 2)
3. Aggiornamento test (Commit 3)
4. Aggiunta `previewHtml` nel parser + tipi (Commit 4)
5. Pannello anteprima in `EntityReview.tsx` (Commit 5)
6. Test UI (Commit 6)
7. Documentazione (Commit 7)
