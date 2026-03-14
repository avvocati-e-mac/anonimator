# Sessione 003 — Fase 3: Document Parsers (TXT/DOCX/ODT)
**Data:** 2026-03-05
**Stato:** COMPLETATA

## File creati
- `src/main/parsers/txtParser.ts` — legge UTF-8 con fallback latin1
- `src/main/parsers/docxParser.ts` — unzip + XML parsing con fast-xml-parser
- `src/main/parsers/odtParser.ts` — unzip + XML parsing content.xml
- `src/main/parsers/index.ts` — aggiornato con implementazioni reali + switch exhaustivo
- `tests/parsers.test.ts` — 19 test unitari (6 detectFormat + 4 txt + 5 docx + 4 odt)
- `tests/fixtures/sample.txt` — documento legale fittizio con CF, IBAN, email, tel
- `tests/fixtures/sample.docx` — fixture DOCX generata programmaticamente
- `tests/fixtures/sample.odt` — fixture ODT generata programmaticamente
- `tests/fixtures/createFixtures.mjs` — script per rigenerare i fixture

## Scoperta tecnica: fast-xml-parser con isArray

Quando `isArray` include `w:t`, il parser lo trasforma SEMPRE in array.
Quindi `run['w:t']` è sempre `Array<{#text, @_xml:space} | string>`, mai solo oggetto/stringa.
→ Necessario gestire tutti e tre i casi in `extractTextFromParagraph`.

Questo bug è stato trovato dai test falliti (chars: 0 con paragrafi trovati) e corretto.

## Struttura XML DOCX
```
w:document > w:body > w:p[] > w:r[] > w:t[] > {#text, @_xml:space}
```
- `w:p` = paragrafo
- `w:r` = run (testo con stessa formattazione)
- `w:t` = testo effettivo (può avere @_xml:space="preserve" per spazi)

## Struttura XML ODT
```
office:document-content > office:body > office:text > text:p[] > {#text, text:span[]}
```

## Test totali: 35/35 passati
- 10 regex NER
- 7 sessionManager
- 6 detectFormat
- 4 txtParser
- 5 docxParser
- 4 odtParser (3 passano, 1 atteso errore su file non ODT)

## Prossimo: Fase 4
- PDF nativo: pdfjs-dist per estrazione testo + coordinate
- OCR: tesseract.js con ita.traineddata per PDF scansionati e immagini
- Threshold OCR: se confidenza < 60% mostrare warning
- Auto-detect: se PDF ha poco testo (< 100 chars/pagina) → switch automatico a OCR
