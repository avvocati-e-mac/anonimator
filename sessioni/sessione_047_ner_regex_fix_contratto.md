# Sessione 047 — Fix NER: entità mancanti nel contratto di locazione
**Data:** 2026-03-29
**Versione:** 1.4.0 (nessun bump — fix interni al Main, nessuna nuova API pubblica)

## Obiettivo
Analisi del file `contratto_clean_anonimizzato.pdf` ha rivelato 4 classi di entità non rilevate dalla pipeline regex. Correzione dei pattern e aggiunta del tipo `LUOGO_NASCITA`.

## Decisioni prese

- `LUOGO_NASCITA` aggiunto come EntityType dedicato (non riusa `LUOGO`) perché:
  - Le entità `LUOGO` dal BERT hanno `confirmed: false`; il luogo di nascita ha contesto certo → `confirmed: true`
  - Label UI più chiara per l'utente ("Luogo di nascita")
  - Non interferisce con il boosting NER delle LOC generiche

- `INDIRIZZO_PATTERN_CORSO`: rimosso `\s` dal character class del nome corso (`[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,5}`) perché il vecchio `[A-Za-zÀ-ÿ\s]{2,40}` ingoiava il numero civico e poi `\d+` non trovava nulla → nessun match.

## File modificati
- `src/shared/types.ts` — aggiunto `'LUOGO_NASCITA'` all'union EntityType
- `src/renderer/src/utils/entityConfig.ts` — entry LUOGO_NASCITA (label, colore green, icona MapPin)
- `src/main/services/regexPatterns.ts`:
  - `DATA_NASCITA_PATTERN`: branch letterale italiano (gennaio…dicembre, anno 4 cifre)
  - `LUOGO_NASCITA_PATTERN`: **NEW** — `nato/nata a <Città> il` con lazy quantifier
  - `INDIRIZZO_PATTERN_STANDARD`: `residente attualmente`, `sito`, CAP flessibile (`- \d{5}`)
  - `INDIRIZZO_PATTERN_CORSO`: stesse keyword + fix charclass nome corso
  - `NUMERO_DOCUMENTO_PATTERN`: `\s?` tra `[A-Z]{2}` e `[0-9]{5,7}`
  - `STRUCTURED_LEGAL_PATTERNS`: aggiunta voce `LUOGO_NASCITA_PATTERN`
- `tests/nerRegex.test.ts` — 19 nuovi test (4 describe block)

## Risultati test
- Pre-sessione: 247 test (19 file)
- Post-sessione: 266 test (19 file, +19 nuovi)
- TypeScript strict: 0 errori
- 1 test fallito in prima run (CORSO + `sito`) → diagnosticato e corretto

## Entità ora rilevate nel contratto di locazione (erano mancanti)
| Entità | Testo campione |
|---|---|
| DATA_NASCITA | `23 luglio 1968`, `12 gennaio 1985`, `07 agosto 1971` |
| LUOGO_NASCITA | `Napoli`, `Salerno`, `Milano` |
| INDIRIZZO | `Via Roma, 112 - 10121 Torino`, `Viale Piemonte, 34 - 10138 Torino`, `Corso Buenos Aires, 15 10129` |
| NUMERO_DOCUMENTO | `CA 5528847` |

## Report test suite completa (sessione 047 — parte 2)

Test eseguiti su tutti i file in `anonimator_test_files/` (contratto, sentenza, perizia × clean/ocr × pdf/docx/odt/txt/md).

### Punteggi per coppia

| Documento | Entità trovate | ✅ Corrette | ❌ Mancanti | ⚠️ Parziali |
|---|---|---|---|---|
| contratto_clean.pdf | 19 | 17 (89%) | 2 | 1 |
| contratto_ocr.pdf | 21 | ~13 (62%) | 8 | — |
| sentenza_clean.pdf | 27 | 14 (52%) | 5 | 8 |
| sentenza_ocr.pdf | 29 | 11 (38%) | 14 | 4 |
| perizia_clean.pdf | 23 | 12 (52%) | 8 | 3 |
| perizia_ocr.pdf | 23 | 10 (43%) | 10 | 3 |

### Bug critici identificati

1. **IBAN con spazi non rilevato** — `IT89 H030 6909...` non matcha `IBAN_PATTERN` che non gestisce spazi interni. Fix: aggiungere `[\s]?` ogni 4 cifre.
2. **sentenza_ocr.odt = 0 entità sostituite** — log conferma `entitiesReplaced: 0`. Bug nel parser/generatore ODT per documenti OCR. Da investigare.
3. **Testimoni/professionisti non rilevati come PERSONA** — "Ing. Stefano Moretti Ricci" (testimone a fine contratto), "Carla Russo Martinelli" (perito), "Dr. Antonio Barone". Pattern contestuali non coprono struttura con titolo + nome a fine paragrafo.

### Bug medi

4. **ORGANIZZAZIONI** (banche, assicurazioni) non anonimizzate — solo BERT le rileva, su OCR il BERT fatica con nomi tutto-maiuscolo.
5. **OCR degradation** — caratteri simili scambiati (O→0, I→l, |) fanno fallire match CF e nomi; nessuna normalizzazione pre-regex.
6. **Nomi con titolo** (`Ing.`, `Dr.`) dopo firma non catturati — `PERIZIA_SOGGETTO_PATTERN` non copre il caso.

### Bug minori

7. Luogo nascita ridotto a iniziale (`N.`, `S.`) — potenzialmente re-identificabile
8. Date di rilascio documento non anonimizzate
9. Targhe veicoli non coperte (nessun pattern)

### Priorità fix prossima sessione

1. **Fix IBAN con spazi** — regex semplice, alto impatto
2. **Investigare sentenza_ocr.odt = 0 sostituzioni** — bug critico
3. **Pattern testimoni/professionisti con titolo** — estendere `PERIZIA_SOGGETTO_PATTERN` o aggiungere pattern `(?:Testimone|Ing\.|Dr\.)\s+([A-Z]...)`
4. **Pattern IBAN tollerante** — già in coda

## Problemi noti / TODO prossima sessione
- [ ] Fix IBAN con spazi interni (regex)
- [ ] Investigare sentenza_ocr.odt = 0 entità sostituite (bug ODT parser/generator)
- [ ] Pattern testimoni con titolo (Ing., Dr.) a fine paragrafo
- [ ] Il `INDIRIZZO_PATTERN` (deprecated) non è stato aggiornato — allinearlo o rimuoverlo
- [ ] Reminder maggio 2026: sostituire `softprops/action-gh-release@v2` con `gh release create` (vedi sessione_045)
