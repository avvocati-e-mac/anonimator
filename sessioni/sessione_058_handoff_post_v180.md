# Sessione 058 — Handoff post-release v1.8.0

**Data:** 2026-09-11  
**Versione:** 1.8.0 stabile

## Stato consegnato

- Branch corrente: `master`.
- `master` locale e `origin/master`: `73398771853231dcddf2d20a53d521264ddecb2b` (`chore: merge v1.8.0 release`).
- Tag annotato immutabile `v1.8.0`: tag object `b470cffa541aba6c8e3ebbf91c42fd28841e5daa`, dereferenziato al commit `73398771853231dcddf2d20a53d521264ddecb2b`.
- Branch di sviluppo integrata: `feat/ner-recall-v18`, tip `3e3a20c` (`chore(release): prepare v1.8.0`).
- Working tree pulito prima della creazione di questo handoff.

## Release ufficiale

- GitHub Release stabile, non draft e non prerelease: <https://github.com/avvocati-e-mac/anonimator/releases/tag/v1.8.0>
- Workflow del tag: <https://github.com/avvocati-e-mac/anonimator/actions/runs/34611067593>, concluso con successo.
- `Anonimator-1.8.0-arm64.dmg`: 261052015 byte, SHA-256 `1abbd9eb19692680634e1fe2e50d264e4b1f5b137f94d0b3153afcce6d9ef88d`.
- `Anonimator-1.8.0-x64.dmg`: 274629584 byte, SHA-256 `7d5b2409bda46c5a3bb19a3da4883fbee3d193c478d394cd45c86c857fe3ef00`.
- `Anonimator-1.8.0-windows-x64-setup.exe`: 227132385 byte, SHA-256 `abb1795de8cdf2c8acd2d2ecfd9f03115879060b2b253a64c7945270cdaf2457`.
- `Anonimator-1.8.0-linux-x86_64.AppImage`: 500603688 byte, SHA-256 `a63895738ec2b10920c1568aa292bde0c635b83157ebf0a86723fb4453241afc`.

## Gate eseguiti sul contenuto della release

- Typecheck applicazione, test e fixture: verde.
- Build Electron/Vite: verde.
- Unit test: 38 file, 588 test verdi.
- Evaluation NER sintetica: 21 casi, 26 TP, 0 FP, 0 FN; precision/recall/F1 micro e macro 1,0 sul corpus definito.
- Corpus OCR: 57 test verdi.
- Roundtrip Tesseract italiano: 60 PDF, 365 parole OCR reali, nessuna anomalia.
- Pixel leak: 2 test verdi.
- PDF ricercabile e sanitizzazione: 3 test verdi.
- RSS PDF ripetuto: 130,2–130,3 MiB, stabile.
- Gli stessi quality/privacy gate sono verdi nel workflow remoto prima del packaging.

## Evidenza del test utente

- Il risultato NER è stato giudicato migliore ma non perfetto: almeno un'entità presente nel documento non è stata proposta automaticamente.
- L'entità aggiunta manualmente è stata rimossa correttamente quando inserita con il testo completo; nel primo tentativo mancava la `A` finale e quindi l'exact match non poteva trovarla.
- L'interfaccia ora distingue il vero OCR di analisi dalla generazione dell'output: nella seconda fase dichiara il riuso del testo OCR in memoria e la ricostruzione del documento.
- Non riportare nel repository nomi, percorsi o contenuto del documento reale usato dall'utente.

## Vincoli da conservare

- Non indebolire trust boundary, capability di analisi, ledger delle entità o pipeline PDF fail-closed.
- Un output `_DA_VERIFICARE` deve restare raster-only e deve richiedere controllo manuale.
- Non acquisire, loggare o versionare dati personali; riprodurre ogni nuovo caso soltanto con fixture sintetiche equivalenti.
- Ogni correzione deve avere un test; prima di release future rieseguire tutti i gate sopra.
- Verificare sempre stato remoto, tag e release live: non assumere che questo handoff resti aggiornato.

## Lavoro successivo suggerito

1. Scegliere con l'utente la prossima fase. I debiti già esplicitamente rinviati sono: strategie DPI, output bitonale, cleanup dell'overlay legacy e firma/notarizzazione.
2. Per il DPI, partire da benchmark sintetici su leggibilità OCR, geometria, dimensione dell'output e memoria; non modificare il default 300 DPI senza evidenza e gate riproducibili.
3. Per il NER, aggiungere casi solo quando il falso negativo può essere espresso sinteticamente; evitare fix basati sul documento personale appena testato.
4. Correggere in una fase di manutenzione gli avvisi CI sulla runtime Node 20 interna alle action, senza mescolarli alle modifiche della pipeline documentale.

## Prompt consigliato per la nuova chat

> Lavora nel repository `/Users/filippostrozzi/Documents/Sviluppo App/anonimator`. Leggi integralmente `CLAUDE.md` e `sessioni/sessione_058_handoff_post_v180.md`, poi verifica live Git, tag, release e baseline senza assumere che lo stato remoto sia invariato. Parti da `master` aggiornato e proponi un audit breve della prossima fase, mantenendo invariati trust boundary e pipeline PDF fail-closed. Non usare né versionare dati personali e aggiungi test per ogni correzione. Prima di pubblicare tag o release chiedi autorizzazione esplicita.
