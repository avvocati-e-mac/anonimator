# Sessione 049 — Report qualità NER: analisi documenti base vs anonimizzati
**Data:** 2026-03-30
**Versione:** 1.4.0

## Obiettivo
Test manuale dell'app su suite completa di file (contratto/perizia/sentenza × clean/ocr × formati multipli).
Analisi comparativa coppia originale/anonimizzato per valutare la qualità del riconoscimento entità.
I file .txt sono stati usati come riferimento per l'analisi (stesso contenuto degli altri formati).

## Metodo
6 sub-agenti paralleli, uno per coppia di documenti, hanno letto originale + anonimizzato e identificato
manualmente tutte le entità sensibili, verificando quante fossero state effettivamente sostituite.

---

## Score per documento

| Documento | Tipo | Entità totali | Anonimizzate | Mancate | Score |
|-----------|------|---------------|--------------|---------|-------|
| contratto_clean | clean | 21 | 21 | 0 | **100.0%** |
| contratto_ocr | ocr | 22 | 18 | 4 | **81.8%** |
| perizia_clean | clean | 19 | 13 | 6 | **68.4%** |
| perizia_ocr | ocr | 21 | 13 | 8 | **61.9%** |
| sentenza_clean | clean | 30 | 22 | 8 | **73.3%** |
| sentenza_ocr | ocr | 27 | 13 | 14 | **48.1%** |

## Score aggregato

| Categoria | Totale entità | Anonimizzate | Score |
|-----------|---------------|--------------|-------|
| Documenti clean | 70 | 56 | **80.0%** |
| Documenti OCR | 70 | 44 | **62.9%** |
| **TOTALE** | **140** | **100** | **71.4%** |

---

## Cosa funziona bene (>90% recall)
- Codici fiscali — regex preciso, quasi infallibile su testo clean
- IBAN — fix sessione 048 funziona, riconosce formato con spazi
- Email — alta copertura su testo clean
- Nomi di persone fisiche — buona copertura, TITOLO_NOME_PATTERN funziona
- Date e luoghi di nascita — copertura eccellente
- Partite IVA — riconoscimento solido

---

## Lacune sistematiche identificate

### 1. Falsi positivi su testo MAIUSCOLO — critico per qualità percepita
Intestazioni di sezione anonimizzate erroneamente:
- `PREMESSO CHE` → `P. C.`
- `SVOLGIMENTO DEL PROCESSO` → `S. D. P.`
- `MOTIVI DELLA DECISIONE` → `M. D. D.`
- `DOCUMENTAZIONE ESAMINATA` → `D. E.`
- `VALUTAZIONE DEL DANNO` → `V. D. D.`
Il modello Transformers.js le classifica come entità PERSONA/ORGANIZZAZIONE. Serve stoplist.

### 2. Organizzazioni/Ragioni sociali — non anonimizzate sistematicamente
- `Banca Commerciale Italiana S.p.A.` — ignorata o anonimizzata solo nell'ultima occorrenza
- `Compagnia Assicurazioni Generali Italia S.p.A.` — non rilevata
- `Società Logistica del Sud S.r.l.` — non rilevata
Il modello NER le tende a non classificare come sensibili, o le tratta in modo incoerente.

### 3. Numeri di procedimento / sentenza — non rilevati
Pattern `N_SENTENZA` esiste nei tipi ma regex non copre i formati reali:
- `SENTENZA N. 1247/2024`
- `R.G. n. 8934/2023`
- `R.G. n. 4521/2023`

### 4. Indirizzi ripetuti nel corpo del testo — sostituzione incoerente
Indirizzo in intestazione → sostituito con `IND_XXX`. Stessa stringa nel corpo → spesso parzialmente
anonimizzata (`Via G. (2) Garibaldi, 24 - 20121 Milano`) invece di riusare il placeholder già assegnato.

### 5. Codici fiscali OCR-distorti — regex fallisce
- `RSSMRG7SD12F2O5Z` (S al posto di 5, O al posto di 0)
- `LM8RTB68H03H501X` (8 al posto di B)
Il pattern CF richiede struttura esatta che OCR compromette.

### 6. Targa veicolo — nessun pattern presente
`FX 523 KL` — non rilevata.

### 7. Numero documento identità — nessun pattern presente
`CA 5528847` (carta d'identità italiana) — non rilevata.

---

## Priorità di fix suggerita

| Priorità | Fix | Impatto stimato |
|----------|-----|-----------------|
| 1 | Stoplist intestazioni legali MAIUSCOLO (anti-falso-positivo) | qualità percepita |
| 2 | Coerenza sostituzione: riuso placeholder per occorrenze ripetute dello stesso indirizzo | qualità output |
| 3 | Pattern N_SENTENZA / R.G. esteso ai formati reali | +3-5 entità/doc |
| 4 | Anonimizzazione organizzazioni più aggressiva | +2-4 entità/doc |
| 5 | Pattern targa italiana (`[A-Z]{2} [0-9]{3} [A-Z]{2}`) | +1 entità/doc |
| 6 | Pattern numero documento identità (`[A-Z]{2} [0-9]{7}`) | +1 entità/doc |

---

## File di test usati
`/Users/filippostrozzi/Library/Mobile Documents/com~apple~CloudDocs/Downloads/anonimator_test_files/`
- contratto_clean.txt / contratto_clean_anonimizzato.txt
- contratto_ocr.txt / contratto_ocr_anonimizzato.txt
- perizia_clean.txt / perizia_clean_anonimizzato.txt
- perizia_ocr.txt / perizia_ocr_anonimizzato.txt
- sentenza_clean.txt / sentenza_clean_anonimizzato.txt
- sentenza_ocr.txt / sentenza_ocr_anonimizzato.txt

## Problemi noti / TODO prossima sessione
- [ ] Fix priorità 1: stoplist per intestazioni legali MAIUSCOLO
- [ ] Fix priorità 2: coerenza riuso placeholder indirizzi ripetuti
- [ ] Fix priorità 3: pattern N_SENTENZA / R.G. formati reali
- [ ] Fix priorità 4: organizzazioni più aggressivo
- [ ] Fix priorità 5+6: targa + numero documento identità
- [ ] Reminder maggio 2026: sostituire softprops/action-gh-release@v2 con gh release create
- [ ] Merge branch feat/ner-pipeline-improvements → master e release v1.5.0 (dopo fix)
