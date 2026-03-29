# REPORT — NER Pipeline Improvements
**Branch:** `feat/ner-pipeline-improvements`
**Data:** 2026-03-29
**Versione baseline:** 1.4.0

---

## Stato baseline

### `npm run typecheck`
```
✅ 0 errori TypeScript strict
```

### `npm run test`
```
Test Files  15 passed (15)
     Tests  199 passed (199)
  Duration  6.42s
```

Tutti i test passano. Nessun errore preesistente.

---

## Analisi `nerService.ts`

### 1.1a — Regex esistenti (Step 0, 0b, Step 1)

**Step 0 — Header sentenza:**
| Costante | Pattern | Tipo entità |
|---|---|---|
| `SENTENCE_HEADER_PATTERN` | `([Nome Cognome]) - Presidente/Giudice/ecc. -` | `PERSONA` |

**Step 0b — Pattern strutturati legali (`STRUCTURED_LEGAL_PATTERNS`):**
| Costante | Tipo entità | Note |
|---|---|---|
| `PROCESSO_PARTE_PATTERN` | `PERSONA` | ricorrente/appellante/attore/ecc. + nome |
| `DIFENSORE_PATTERN` | `PERSONA` | difeso/assistito + avv. + nome |
| `ALLCAPS_NAME_PATTERN` | `PERSONA` | nome tutto-maiuscolo su riga propria |
| `DATA_NASCITA_PATTERN` | `DATA_NASCITA` | nato/nata/data di nascita + data |
| `INDIRIZZO_PATTERN` | `INDIRIZZO` | residente/domiciliato + Via/Viale/Corso/Piazza/ecc. + CAP |
| `NUMERO_DOCUMENTO_PATTERN` | `NUMERO_DOCUMENTO` | carta d'identità/passaporto/patente + codice |
| `POLIZZA_PARTE_PATTERN` | `PERSONA` | Contraente/Assicurato/Beneficiario + nome |
| `CONTRATTO_PARTE_PATTERN` | `PERSONA` | tra/fra + nome + nato/residente/ecc. |
| `PERIZIA_SOGGETTO_PATTERN` | `PERSONA` | Paziente/CTU/CTP/Perito + nome |

**Pattern separati fuori da `STRUCTURED_LEGAL_PATTERNS`:**
| Costante | Tipo | Note |
|---|---|---|
| `AVV_LISTA_PATTERN` | `PERSONA` | avvocati in lista separata da virgola |
| `PKI_FIRMA_PATTERN` | `PERSONA` | Firmato Da: NOME COGNOME Emesso Da: |

**Step 1 — Pattern strutturati (`REGEX_PATTERNS`):**
| Costante | Tipo |
|---|---|
| `CODICE_FISCALE` | `CODICE_FISCALE` |
| `PARTITA_IVA` | `PARTITA_IVA` |
| `IBAN` | `IBAN` |
| `EMAIL` | `EMAIL` |
| `TELEFONO` | `TELEFONO` |

**Pattern per `corso` distinto da `via/piazza/viale`:**
❌ **Assente.** `INDIRIZZO_PATTERN` usa `(?:Via|Viale|Corso|Piazza|Largo|Vicolo|Str\.|Loc\.|Fraz\.|V\.le)` senza distinguere "Corso Vittorio Emanuele 12" (indirizzo) da "corso di indagini" (formula processuale). Il pattern richiede un CAP finale, ma mancano falsi positivi evidenti nella regex attuale — tuttavia il problema è reale in testi privi di CAP o con formule come "nel corso delle indagini, residente in Via...".

### 1.1b — Pattern Codice Fiscale

**Pattern attuale:** `/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi`

**Analisi validazione:**
- Cognome (6 lettere): ✅ solo `[A-Z]{6}`
- Anno (2 cifre): ✅ `[0-9]{2}`
- **Lettera mese:** ❌ usa `[A-Z]` invece di `[ABCDEHLMPRST]` — accetta lettere invalide come Q, W, Y, ecc.
- **Giorno (codificato):** ❌ usa `[0-9]{2}` invece di `(0[1-9]|[1-6][0-9]|7[01])` — accetta 00, 72–99
- Comune (1 lettera + 3 cifre): ✅ `[A-Z][0-9]{3}`
- Carattere di controllo: ✅ `[A-Z]`

**Lacune rispetto a validazione piena:** la lettera di mese invalida (es. "Q") e il giorno "99" sarebbero accettati. In pratica nei fascicoli giuridici questo genera falsi positivi su identificatori alfanumerici casuali (numeri pratica, codici archivio).

### 1.1c — Soglie NER

```typescript
const SCORE_THRESHOLDS: Record<string, number> = { PER: 0.50, ORG: 0.60, LOC: 0.65 }
```

**Meccanismo di boost score:** ❌ Assente. Il layer regex Step 0b e il layer BERT sono pipeline completamente separate. Non esiste alcun meccanismo che aumenta lo score BERT in presenza di conferma regex contestuale. Le entità sotto soglia vengono semplicemente scartate.

### 1.1d — Filtri di rumore post-NER

**Implementati:**
- `PUBLIC_INSTITUTION_PREFIXES`: filtra ORG che iniziano con "tribunale", "corte", "procura", ecc.
- `PKI_NOISE`: filtra token PKI ("ng", "ca", "ra", ecc.)
- `ALLCAPS_BLOCKLIST`: blocklist per acronimi in maiuscolo ("INPS", "INAIL", "SPA", ecc.)
- `NAME_STOPWORDS`: filtra token come "presidente", "giudice", "ricorrente" dai nomi aggregati

**NON filtrato:**
- ❌ Ruoli processuali classificati come `PER` dal modello BERT: "RICORRENTE", "APPELLANTE", "IMPUTATO" come entità standalone. `NAME_STOPWORDS` filtra questi token solo dalla fase di aggregazione BIO e dal nameTokenSet, **non** come entità complete classificate da BERT (es. se BERT restituisce `{word: "RICORRENTE", label: "PER", score: 0.72}` come entità autonoma, passa i filtri).
- ❌ Nessun veto filter esplicito post-NER sulle stop words legali.

### 1.1e — Funzione `isSameName()`

**Logica:** converte entrambe le stringhe in set di token (lowercase, > 1 char, non in NAME_STOPWORDS), poi verifica che tutti i token del set più piccolo siano contenuti nel set più grande.

**Casi limite:**
- Richiede `setA.size >= 2 && setB.size >= 2` → un nome con un solo token non-stopword non viene mai matchato con `isSameName()`. Potrebbe generare falsi negativi per cognomi composti o nomi con preposizioni (es. "De Luca" → tokens: {"de", "luca"} ma "de" è < 2 chars? No, len=2, passa. Però "De" viene normalizzato a lowercase "de", lunghezza 2 > 1, non in stopwords → passa).
- Case-insensitive: ✅ (tutto in lowercase)
- "MARIO ROSSI" vs "Mario Rossi" → ✅ funziona (entrambi normalizzati)
- "Rossi Mario" vs "Mario Rossi" → ✅ funziona (set matching, non ordered)
- **Falso negativo possibile:** se uno dei due ha un solo token significativo (es. "Rossi" vs "Mario Rossi"), `setA.size < 2` → ritorna false. Questo è intenzionale (evita match troppo aggressivi su cognomi comuni).

### 1.1f — Chunking

**Dimensione chunk BERT:** 400 parole (con backtracking fino a 20 parole verso un punto fermo `.?!`)
**Batch size:** 4 chunk in parallelo
**Overlap:** ❌ **Assente.** Chunking sequenziale senza sovrapposizione. Entità a cavallo del boundary tra chunk N e N+1 vengono perse. Nessuna gestione delle entità a cavallo di chunk boundary.

### 1.1g — Pipeline regex ↔ NER

**Pipeline completamente separate.** L'unico punto di integrazione è `foundTexts: Set<string>` usato per deduplicazione: se un'entità è già stata trovata dal layer regex, non viene aggiunta se il BERT la trova con lo stesso testo. Non esiste score boosting cross-layer — un'entità BERT con score 0.46 (sotto soglia 0.50) viene scartata anche se il layer regex Step 0b ha trovato lo stesso span.

---

## Analisi `sessionManager.ts`

### 1.2a — Struttura del dizionario

```typescript
private dictionary = new Map<string, SessionEntry>()
private counters = new Map<EntityType, number>()
```

Il dizionario è una `Map<string, SessionEntry>` dove la chiave è il testo originale normalizzato (lowercase, trimmed) e il valore è `{ pseudonym: string, type: EntityType }`. Struttura in-memory, mai su disco (tranne `saveToDisk()`/`loadFromDisk()` che è esplicita).

### 1.2b — Cache NER

❌ **Assente.** Non esiste alcun meccanismo di cache `Map<hash(chunk), Entity[]>` nel sessionManager né in nerService. Ogni documento viene elaborato integralmente dal modello BERT, anche se contiene chunk di testo identici a documenti già processati nella stessa sessione.

---

## Analisi `src/shared/types.ts`

### 1.3a — Campo `score` in `DetectedEntity`

```typescript
export interface DetectedEntity {
  id: string
  type: EntityType
  originalText: string
  pseudonym: string
  occurrences: number
  confirmed: boolean
  fileCount?: number
}
```

❌ **`score` non presente** nell'interfaccia `DetectedEntity`. Lo score è usato solo internamente nella funzione `analyzeText()` (tipo locale `AggregatedEntity`) e non viene mai esposto al Renderer. Il Renderer non ha visibilità sulla confidenza delle entità rilevate.

### 1.3b — Campo `source`

❌ **`source: 'regex' | 'ner' | 'llm' | 'coref'` non presente** in `DetectedEntity`. Non è possibile, dall'interfaccia pubblica, distinguere se un'entità è stata rilevata dal layer regex, da BERT, dall'LLM o da un futuro layer co-reference. Questo impedisce:
- Applicare il veto filter LEGAL_STOP_WORDS solo alle entità NER (non regex)
- Implementare score boosting cross-layer (necessita separazione bert_low vs regex_ctx)
- Future funzionalità di debug/spiegazione

---

## Analisi test esistenti

### 1.4a — Suite di test

```
15 file di test, 199 test totali, tutti verdi
```

**File di test rilevanti per questa sessione:**
| File | Test | Ambito |
|---|---|---|
| `nerRegex.test.ts` | 42 | Pattern regex (CF, IBAN, indirizzo, ecc.) con fixture |
| `sessionManager.test.ts` | 7 | SessionManager (pseudonimi, reset, stats) |
| `nerPageMode.test.ts` | 6 | Modalità page-mode del layer LLM |

**Test per nerService.ts (layer BERT):** ❌ Nessun test diretto. I test `nerRegex.test.ts` replicano i pattern inline (non importano da `nerService.ts`) — vedi punto "Gap identificati" #2.

**Test suite per regex con fixture:** ✅ `nerRegex.test.ts` ha test per tutti i pattern principali con input/output espliciti. Non ha test per:
- Validazione lettera-mese CF (`ABCDEHLMPRST`)
- Validazione range giorno CF
- Distinguere "Corso Roma 15" (indirizzo) da "corso di indagini" (formula)

---

## Gap identificati (ordinati per impatto)

| Priorità | Gap | Impatto | Commit |
|---|---|---|---|
| 1 | **Entità processuali come PER non filtrate** (RICORRENTE, APPELLANTE classificati da BERT come PERSONA standalone) | Alto — rumore diretto per utente avvocato | 3.1 legalStopWords |
| 2 | **Pattern regex duplicati tra nerService.ts e nerRegex.test.ts** — test non importano dal sorgente, drift silenzioso | Alto — i test non proteggono il codice reale | 2.1 extract regexPatterns |
| 3 | **Chunking senza overlap** — entità a cavallo di boundary perse | Alto su documenti lunghi (sentenze Cassazione) | 3.5 sliding window |
| 4 | **Score CF troppo permissivo** — falsi positivi su stringhe alfanumeriche | Medio — riduce qualità NER | 2.2 CF strict |
| 5 | **INDIRIZZO_PATTERN non distingue "corso di"** — formule processuali penali | Medio nei fascicoli penali | 2.3 split corso |
| 6 | **Nessun boosting cross-layer** — entità BERT 0.35–0.49 scartate anche se confermate da regex | Medio — falsi negativi su nomi con bassa confidenza BERT | 3.3 score boost |
| 7 | **Nessuna co-reference resolution** — token singoli ("Rossi") non rilevati dopo entità completa ("Mario Rossi") | Medio — occorrenze successive non anonimizzate | 3.2 co-reference |
| 8 | **Nessuna cache NER** — re-elaborazione di chunk identici in sessioni multi-documento | Basso/prestazioni — latenza inutile su fascicoli compositi | 3.4 NER cache |
| 9 | **Campo `source` assente in DetectedEntity** — impossibile distinguere origine entità | Basso/architetturale — richiesto da 3.1, 3.2, 3.3 | prerequisito di 3.x |

---

## Rischi architetturali

### R1 — Aggiunta campo `source` a `DetectedEntity` (prerequisito per 3.1, 3.2, 3.3)
L'interfaccia `DetectedEntity` è il contratto IPC tra Main e Renderer. Aggiungere `source?: 'regex' | 'ner' | 'llm' | 'coref'` è retrocompatibile (campo opzionale) e non richiede modifiche al Renderer. Tuttavia il Renderer non usa `source` — deve rimanere così. **Rischio: basso** se il campo è opzionale.

### R2 — Refactoring `regexPatterns.ts` (Commit 2.1)
I test `nerRegex.test.ts` replicano i pattern inline invece di importarli. Dopo il refactoring, i test devono essere aggiornati per importare da `regexPatterns.ts` — altrimenti rimangono non protettivi (proteggono le copie, non il codice di produzione). **Rischio: medio** se i test non vengono aggiornati in Commit 2.1.

### R3 — `legalStopWords` veto filter (Commit 3.1)
Il filtro deve applicarsi SOLO a entità di `source === 'ner'`. Senza il campo `source`, il filtro rischia di eliminare entità regex contestuali (Step 0b) che contengono parole come "ricorrente" come prefisso del contesto (es. la regex `PROCESSO_PARTE_PATTERN` cattura il nome *dopo* la keyword, quindi l'entità non contiene la keyword stessa — rischio basso). **Rischio: basso** ma richiede attenzione.

### R4 — Sliding window chunking (Commit 3.5)
Aumenta il numero di chunk del ~11% (stride 360 invece di 400). Su documenti di 50+ pagine, il numero di batch BERT aumenta proporzionalmente. La deduplicazione per span richiede tracking degli offset in caratteri (non solo in parole), che introduce complessità di ricalcolo. **Rischio: alto** — implementare come ultima fase dopo aver verificato le altre.

### R5 — Co-reference resolution (Commit 3.2)
Token singoli comuni (cognomi polisemici: "Bianchi" come colore, "Rossi" come aggettivo) possono generare falsi positivi se appaiono ≥ 2 volte. La soglia ≥ 2 occorrenze riduce ma non elimina il problema. **Rischio: accettabile** — l'utente può deselezionare nella schermata di revisione.

### R6 — Score boosting (Commit 3.3)
Richiede refactoring del flow in `analyzeText()` per raccogliere entità BERT sotto soglia separatamente. Questo modifica la struttura interna della pipeline, con potenziale impatto su tutti i test che mockano il layer NER. **Rischio: medio** — richiede mock accurato del BERT nei test.

---

---

## Decisioni architetturali prese

### D1 — Campo `source` aggiunto a `DetectedEntity` come opzionale
Aggiunto `source?: 'regex' | 'ner' | 'llm' | 'coref' | 'boosted'` in `types.ts`. Campo opzionale per retrocompatibilità — il Renderer non lo usa per la UI. Prerequisito per legalStopWords filter, co-reference resolution e score boosting.

### D2 — Commit 2.3 inglobato nel 2.1
Il split `INDIRIZZO_PATTERN_CORSO` è stato implementato contestualmente al refactoring 2.1, perché era necessario modificare `STRUCTURED_LEGAL_PATTERNS` che è stato estratto nello stesso commit. Separare avrebbe richiesto un terzo passaggio sugli stessi file senza benefici. Documentato come nota nel commit message di 2.2.

### D3 — applyContextualBoost senza score raw
`DetectedEntity` non espone un campo `score` (è interno al loop BERT). La funzione `applyContextualBoost` usa il confronto testo per verificare la conferma regex invece di un calcolo `score * 1.5`. La promozione è binaria: se c'è una conferma regex, l'entità viene promossa. Motivo: aggiungere un campo `_score` interno sarebbe un type hack proibito dal CLAUDE.md.

### D4 — Sliding window senza adaptive splitting per header giuridici (Parte B non implementata)
La Parte B del Commit 3.5 (chunking adattivo su header giuridici) non è stata implementata perché i `SENTENCE_HEADER_PATTERN` operano già a livello di testo completo (Step 0) — spezzare i chunk in corrispondenza degli header causerebbe duplicazione di entità già rilevate. Il beneficio marginale non giustifica la complessità aggiuntiva. Documentato come TODO.

### D5 — NER cache salva solo entità sopra soglia
La cache NER (`nerChunkCache`) salva solo le entità `aboveThreshold`, non le `belowThreshold`. Le entità sotto soglia sono candidate al boost contestuale che dipende dalle entità regex dell'analisi corrente — non sono cache-safe tra sessioni diverse (lo stesso chunk in un documento diverso potrebbe avere una conferma regex diversa).

---

## TODO aperti (residui post-sessione)

- [x] Aggiornare `nerRegex.test.ts` per importare da `regexPatterns.ts` — FATTO in Commit 2.1
- [x] Aggiungere `source` come campo opzionale in `DetectedEntity` — FATTO in Commit 3.1
- [ ] **Misurare delta latenza sliding window** su documento di test 20+ pagine — non eseguito (richiede documento reale, non disponibile in CI). TODO per validazione manuale.
- [ ] **Parte B Commit 3.5** (adaptive splitting su header giuridici) — non implementata (vedi D4). TODO per sessione successiva se necessario.
- [ ] **Entità INDIRIZZO_PATTERN_CORSO senza CAP** — il pattern attuale richiede ancora CAP in fondo. Valutare se il CAP è realmente sempre presente nei testi OCR/PDF. TODO.
- [ ] **Co-reference su nomi polisemici** — "Bianchi" (colore) e "Rossi" (aggettivo) possono generare falsi positivi se appaiono ≥ 2 volte. Soglia attuale (≥ 2 occorrenze) riduce ma non elimina. TODO: valutare soglia ≥ 3 in base a feedback utenti.

---

## Risultati finali (Fase 4)

### `npm run typecheck` — PASS
```
0 errori TypeScript strict
```

### `npm run test` — PASS
```
Test Files  19 passed (19)   [baseline: 15]
     Tests  247 passed (247) [baseline: 199, +48 nuovi test]
  Duration  6.78s
```

### Checklist di sicurezza
- [x] Nessun `console.log` nei file modificati che stampi contenuto documentale
- [x] `nerChunkCache` usa hash SHA-256 come chiave — testo in chiaro non recuperabile
- [x] `legalStopWords.ts` non esporta dati personali
- [x] Nessun dato del documento serializzato su disco in percorsi non previsti
- [x] Flag `strictCF: false` di default (lenient per compatibilità OCR)
- [x] `LEGAL_STOP_WORDS` veto filtra SOLO entità con source `'ner'` — non `'regex'`
- [x] `clearNerChunkCache()` chiamata su `session:reset` e su download nuovo modello
- [x] `source` campo opzionale in `DetectedEntity` — retrocompatibile, nessun Renderer impact

### Commit deliverable (in ordine)
1. `refactor: extract regex patterns to dedicated module`
2. `fix: strengthen codice-fiscale regex with strict validation flag` (include 2.3 corso split)
3. `feat: add legalStopWords as post-NER veto filter`
4. `feat: add co-reference resolution for single-token person mentions`
5. `feat: add contextual score boosting for cross-layer NER/regex confirmation`
6. `feat: add NER chunk cache for multi-document sessions`
7. `feat: implement sliding-window chunking with overlap to fix entity boundary splits`

### Rischi residui
- Co-reference su cognomi polisemici (Bianchi, Rossi) — soglia ≥ 2 riduce ma non elimina
- Sliding window aumenta latenza ~11% su documenti lunghi (non misurato su hardware target)
- INDIRIZZO_PATTERN_CORSO richiede CAP — su testi OCR il CAP potrebbe mancare

### Comando per rieseguire tutti i test
```bash
npm run test
```

Per coverage:
```bash
npm run test -- --coverage
```
