# Sessione 024 — NER Ibrido: Layer Regex + BERT

**Data:** 2026-03-07
**Branch:** `feat/ottimizzazione-prompt-llm`

## Obiettivo

Migliorare il recall del NER su documenti legali italiani reali aggiungendo regex specializzate per tipo documento (parti processuali, dati anagrafici, polizze, contratti, perizie) e migliorando il post-processing BERT.

## Modifiche effettuate

### `src/shared/types.ts`
- Aggiunti tre nuovi EntityType: `DATA_NASCITA`, `INDIRIZZO`, `NUMERO_DOCUMENTO`

### `src/main/services/sessionManager.ts`
- Aggiunti prefissi pseudonimi: `DATA_NASCITA → NASC`, `INDIRIZZO → IND`, `NUMERO_DOCUMENTO → DOC`

### `src/main/services/nerService.ts`
**Nuove costanti:**
- `PUBLIC_INSTITUTION_PREFIXES` — blocklist istituzioni pubbliche per filtro post-BERT
- `PKI_NOISE` — blocklist frammenti PKI (NG, CA, G3, ecc.)
- `ALLCAPS_BLOCKLIST` — blocklist acronimi per Pattern A3
- `SCORE_THRESHOLDS` — soglie score differenziate per label BERT: PER=0.50, ORG=0.60, LOC=0.65

**Nuovi pattern regex (Step 0b in `analyzeText`):**
- A1: `PROCESSO_PARTE_PATTERN` — parti del giudizio con keyword ruolo processuale
- A2: `DIFENSORE_PATTERN` — avvocati difensori
- A3: `ALLCAPS_NAME_PATTERN` — nomi tutto-maiuscolo su riga propria (conservativo)
- B1: `DATA_NASCITA_PATTERN` — date di nascita (`nato il`, `Data di nascita:`)
- B2: `INDIRIZZO_PATTERN` — indirizzi con CAP
- B3: `NUMERO_DOCUMENTO_PATTERN` — numeri documenti d'identità/passaporto/patente
  - Fix critico: usa `\s*` (non `\s+`) dopo apostrofo in "d'identità" + separatore `[\s:,n.°]+`
- C1: `POLIZZA_PARTE_PATTERN` — Contraente/Assicurato/Beneficiario
- C2: `CONTRATTO_PARTE_PATTERN` — parti contratto (formula "tra X, nato/residente")
- C3: `PERIZIA_SOGGETTO_PATTERN` — Paziente/CTU/CTP/Perito

**Miglioramenti post-processing BERT:**
- Soglie score differenziate per label
- Filtro `PKI_NOISE` per frammenti tipo "NG", "CA"
- Filtro `PUBLIC_INSTITUTION_PREFIXES` per ORG che iniziano con istituzioni pubbliche

**Fix Step 6 — filtro entità contenute:**
- Prima scarava erroneamente "Strozzi" quando esisteva "Studio Legale Strozzi"
- Ora: scarta l'entità lunga solo se TUTTE le occorrenze del testo corto sono sottostringa di quella lunga

### `src/renderer/src/components/EntityReview.tsx` e `BatchReview.tsx`
- Aggiunte voci `ENTITY_CONFIG` per i tre nuovi EntityType
- Icone: `Calendar` (DATA_NASCITA), `Home` (INDIRIZZO), `FileText` (NUMERO_DOCUMENTO)

### `tests/nerRegex.test.ts`
- Helper `match()` aggiornato per restituire il primo gruppo di cattura non-undefined
- Aggiunti 25 nuovi test per tutti i pattern dei blocchi A, B, C

### `tests/sessionManager.test.ts`
- Aggiornati 5 test che aspettavano il vecchio formato `SOGGETTO_001` (pre-iniziali)

## Ulteriori pattern aggiunti dopo analisi PDF reali (Step 0c)

Analisi comparativa di 5 PDF anonimizzati della stessa sentenza ha rivelato due buchi sistematici:

### D1 — Avvocati in lista (`avvocati NOME A, NOME B`)
```
/avvocat[oi]\s+((?:[A-Z][A-Za-zÀ-ÿ']+(?:\s+[A-Z][A-Za-zÀ-ÿ']+){1,3})(?:\s*,\s*(?:...))*)/gi
```
- Cattura l'intero blocco dopo "avvocati/avvocato", poi split su virgola → N entità separate
- Pattern A2 (DIFENSORE) richiedeva "difeso dall'avv." — non copriva "avvocati X, Y"
- Test con sentenza reale: cattura "VINCENZO LIGUORI" e "MICHELE LIGUORI" ✅

### D2 — Firma digitale PKI (`Firmato Da: COGNOME NOME Emesso Da:`)
```
/Firmato\s+Da:\s+([A-Z][A-Z\u00C0-\u00DC]+\s+[A-Z][A-Z\u00C0-\u00DC]+)\s+Emesso/gi
```
- Copre la riga header/footer dei documenti firmati digitalmente (ArubaPEC, ecc.)
- Test con sentenza reale: cattura "PASSINETTI LUISA" e "BERTUZZI MARIO" ✅

Entrambi processati in Step 0c (separato dall'array STRUCTURED_LEGAL_PATTERNS perché D1 richiede split interno).

## Risultato test
76/76 test passati, typecheck pulito.

## Note tecniche
- Pattern B3: il separatore `[^A-Z]{1,15}` NON funziona con flag `/gi` perché con `i` flag `[^A-Z]` esclude anche lowercase. Usare invece `[\s:,n.°]+` con lista esplicita di caratteri permessi.
- Pattern B1: "Data di nascita" cattura in gruppo 2 (non gruppo 1); test helper deve iterare tutti i gruppi.
- Pattern A3 (tutto-maiuscolo): richiede 2-3 token, scarta token ≤ 2 caratteri e quelli in `ALLCAPS_BLOCKLIST`.

## Release
- Mergiato in master, tag v1.0.9, push + GitHub Actions
- Release pubblicata: https://github.com/avvocati-e-mac/anonimator/releases/tag/v1.0.9
- Asset: Anonimator-1.0.9-arm64.dmg, Anonimator-1.0.9-x64.dmg, Anonimator-1.0.9-windows-x64-setup.exe

## Prossimi passi
- Test manuale con documenti reali (sentenze, contratti, CIE, cartelle cliniche)
- Bug aperto: D'Angiolino troncato → "D' A. INO" — bug nel pdf output generator (redaction spezza token su apostrofo)
- Da considerare: fix pdfParser.ts strutturato (branch feat/pdf-structured-parsing, modifiche in stash/WIP su master)
