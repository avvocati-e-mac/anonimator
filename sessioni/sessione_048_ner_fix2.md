# Sessione 048 — Fix NER: IBAN spazi, titoli professionali, cleanup
**Data:** 2026-03-29
**Versione:** 1.4.0 (nessun bump — fix interni)

## Obiettivo
Continuazione sessione 047. Fix dei 4 problemi sistematici identificati nel report di test della suite completa.

## Fix implementati

### Fix 1 — IBAN con spazi interni ✅
`IBAN_PATTERN`: cambiato da `/\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi` a `/\bIT[0-9]{2}(?:\s?[A-Z0-9]){23}\b/gi`.
Gestisce sia `IT89H0306909606100000117200` (compatto) che `IT89 H030 6909 6061 0000 0117 200` (con spazi).
Test esistente aggiornato (usava IBAN sintetico a 26 char) + 3 nuovi test.

### Fix 2 — sentenza_ocr.odt = 0 sostituzioni ✅ (non è un bug)
Diagnosi: il file ODT e il file PDF della sentenza_ocr hanno testi OCR **diversi** (es. ODT ha `MARI0`, PDF ha `MARIO`). Nel batch multi-formato, le entità rilevate su un file non sono applicabili su un altro file con distorsioni diverse. Comportamento corretto del codice — problema nei file di test eterogenei.

### Fix 3 — Pattern testimoni/professionisti con titolo ✅
`TITOLO_NOME_PATTERN`: nuovo pattern (senza flag `i`) per catturare nome+cognome dopo titoli professionali.
- Titoli coperti: `Ing.`, `Dott./Dott.ssa`, `Dr./Dr.ssa`, `Prof./Prof.ssa`, `Sig./Sig.ra`, `Avv.`, `Arch.`, `Geom.`
- Richiede maiuscola obbligatoria per ogni token del nome (esclude minuscole accidentali)
- Richiede min 2 token (no nome singolo)
- Aggiunto a `STRUCTURED_LEGAL_PATTERNS`

### Fix 4 — Cleanup INDIRIZZO_PATTERN deprecated ✅
Allineato alle keyword di `INDIRIZZO_PATTERN_STANDARD` + `INDIRIZZO_PATTERN_CORSO` (`residente attualmente`, `sito`, CAP flessibile). Non usato nel codice principale — mantenuto solo per compatibilità.

## File modificati
- `src/main/services/regexPatterns.ts` — fix IBAN, nuovo TITOLO_NOME_PATTERN, cleanup INDIRIZZO_PATTERN
- `tests/nerRegex.test.ts` — aggiornato test IBAN + 8 nuovi test TITOLO_NOME (277 totali)

## Risultati test
- Pre-sessione: 269 test
- Post-sessione: 277 test (+8)
- TypeScript strict: 0 errori

## Problemi noti / TODO prossima sessione
- [ ] Reminder maggio 2026: sostituire `softprops/action-gh-release@v2` con `gh release create`
- [ ] Valutare merge branch feat/ner-pipeline-improvements → master e release v1.5.0
- [ ] Test manuale post-fix su contratto/sentenza/perizia con la nuova build
