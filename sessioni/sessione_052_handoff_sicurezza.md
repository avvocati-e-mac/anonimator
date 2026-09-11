# Sessione 052 - handoff sicurezza v1.6.0-beta.2

## Base e contenimento

- Branch ricreato da `a8cbce7` per non propagare nella nuova linea di sviluppo i rilievi tecnici sensibili presenti nei commit successivi.
- La precedente punta locale e conservata nel branch di quarantena `quarantine/ocr-layer-quality-check-unsanitized-20260911`; non deve essere pubblicata o fusa.
- `/logs/` e `/sessioni/locale/` sono esclusi da Git. I dettagli operativi dei difetti di privacy restano solo locali.
- Versione di lavoro: `1.6.0-beta.2`.

## Stato remoto

Il ritiro degli asset di `v1.6.0-beta.1`, l'aggiornamento dell'avviso e il force-push con lease non sono stati eseguiti: l'autenticazione GitHub locale risulta scaduta. Prima di operare sul remoto occorre autenticare di nuovo `gh`, leggere lo SHA remoto atteso e verificare se la release e immutabile.

La riscrittura delle ref e solo contenimento: non elimina copie gia presenti in clone, fork, cache o SHA noti. Una purge tramite GitHub Support va richiesta soltanto se i contenuti soddisfano i requisiti GitHub.

## Vincoli di integrazione

- Nessun dato documentale, box OCR o percorso sorgente deve attraversare il trust boundary verso il Renderer.
- Nessun errore nel percorso scansione puo degradare a overlay.
- I risultati parziali devono essere espliciti; gli errori di sicurezza e persistenza non producono output.
- v1.7 parte solo dopo i gate v1.6 e aggiunge cache OCR RAM e layer testuale invisibile pseudonimizzato.

## Gate locali v1.6.0-beta.2

- `typecheck:all`: verde.
- unit: 32 file, 522 test verdi.
- corpus: 57 test verdi; roundtrip Tesseract reale generato e verificato senza anomalie.
- pixel leak Poppler: 2 test verdi, incluso `/SMask` senza fallback overlay.
- La suite usa un mock globale di `electron-log` e non scrive più nei log utente.

Questi gate consentono di congelare il candidato locale beta.2. Non equivalgono alla
promozione stabile: restano necessari i pacchetti multipiattaforma e i sette giorni
senza P0/P1 previsti dal piano di rilascio.
