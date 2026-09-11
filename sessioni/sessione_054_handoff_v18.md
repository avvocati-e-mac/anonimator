# Sessione 054 — handoff post-release e avvio v1.8


Data: 2026-09-11

## Esito della sessione

Anonimator `v1.7.0-beta.1` è stata pubblicata correttamente:

- release: <https://github.com/avvocati-e-mac/anonimator/releases/tag/v1.7.0-beta.1>
- workflow: <https://github.com/avvocati-e-mac/anonimator/actions/runs/34603045613>
- commit e tag: `b3e7efbbd64bb625e24f6054d17fbbd258d4de3c`
- branch: `feat/ocr-cache-layer-v17`, allineata a `origin/feat/ocr-cache-layer-v17`
- pacchetti: macOS arm64, macOS x64, Windows x64 e Linux x64
- release marcata come prerelease, non come Latest stabile

Tutti i job sono verdi: anti-segreti, typecheck, unit, corpus OCR, roundtrip Tesseract italiano, pixel-leak, searchable PDF, RSS e quattro packaging.

La vecchia release `v1.6.0-beta.1` è stata ritirata: i quattro binari sono stati eliminati, il tag è rimasto per tracciabilità e le note mostrano l'avviso di ritiro. La branch remota `feat/ocr-layer-quality-check` è stata riscritta con `--force-with-lease` sul commit sanificato `5aa192a`; nessuna branch remota contiene più il vecchio commit contaminato `6312c3b`.

## Stato locale

- Branch corrente al momento dell'handoff: `feat/ocr-cache-layer-v17`.
- Versione in `package.json` e lockfile: `1.7.0-beta.1`.
- Il tag immutabile `v1.7.0-beta.1` punta al commit di release `b3e7efb`; questo handoff è il solo commit documentale successivo.
- Il worktree deve risultare pulito dopo il commit di questo handoff.
- Non riscrivere né spostare il tag pubblicato.
- Non promuovere ancora a stabile: servono sette giorni senza P0/P1 e smoke test dei pacchetti.

## Cosa è stato verificato manualmente

Su un PDF reale scansionato di 23 pagine:

- OCR pagina per pagina funzionante;
- entità trovate e una entità manuale anonimizzate correttamente;
- rimozione raster visivamente corretta;
- dimensione finale ragionevole, senza la crescita di circa 30 volte della vecchia pipeline.

Sulla fixture `geo-02-dy-20pt.pdf`:

- il classificatore ha rilevato correttamente lo scostamento di 20 pt come circa 7,1 mm;
- il pulsante `Rifai OCR` è stato eseguito;
- il redo ha restituito zero parole perché il raster della fixture contiene intenzionalmente barre nere geometriche, non glifi leggibili. Non è un bug dell'OCR e non va corretto alterando DPI o preprocessing.

## Baseline verificata

- `npm run typecheck:all`: verde.
- `npm run ui:build`: verde.
- `npm run test:unit`: 35 file, 536 test.
- `npm run test:corpus`: 57 test.
- `npm run test:roundtrip`: 60 PDF, 365 parole OCR reali, nessuna anomalia.
- `npm run test:pixel-leak`: 2 test.
- `npm run test:searchable-pdf`: 3 test.
- `npm run test:pdf-rss`: RSS stabile intorno a 131,8 MiB.

## Architettura da considerare congelata

Non modificare questi invarianti senza una regressione riproducibile e nuovi test:

- token di analisi casuale Main-only, legato a owner, path canonico, fingerprint, report per pagina e ledger;
- Renderer limitato a `{ analysisToken, entities }`;
- fingerprint ricalcolato prima del salvataggio;
- qualunque pagina raster instrada l'intero PDF verso `flattened-scan`;
- nessun fallback overlay per scansioni o PDF misti;
- ricostruzione sequenziale DeviceRGB/JPEG q85 con limite 50 MP;
- una sola `Tesseract.recognize` per pagina;
- cache OCR solo RAM da 128 MiB legata al token;
- layer ricercabile con `Tr 3` soltanto per output `complete`;
- output parziali raster-only e suffisso `_DA_VERIFICARE`;
- scrittura temporanea, validazione di tutte le pagine e rename atomico.

File sensibili con owner unico se si usa lavoro parallelo:

- `src/shared/types.ts`
- `src/main/ipcHandlers.ts`
- `src/main/outputGenerators/pdfSafeGenerator.ts`
- `src/main/services/analysisRegistry.ts`
- `src/main/services/ocrArtifactCache.ts`
- `src/main/services/searchableLayer.ts`

## Limiti e debiti noti

1. Il test manuale ha mostrato falsi negativi nel riconoscimento automatico: l'anonimizzazione di ciò che viene confermato è corretta, ma il recall NER/OCR va migliorato.
2. L'issue GitHub #21 è ancora aperto: <https://github.com/avvocati-e-mac/anonimator/issues/21>. Chiuderlo soltanto dopo uno smoke del DMG arm64 pubblicato che confermi dimensione ragionevole e anonimizzazione corretta.
3. `pdfGenerator.ts` conserva codice legacy non raggiungibile relativo ai vecchi percorsi overlay, mantenuto per test storici. La produzione delega esclusivamente a `pdfSafeGenerator.ts`; la rimozione del dead code può essere un cleanup separato, con migrazione dei test puri.
4. Gli artifact non sono firmati/notarizzati. Lo smoke deve usare la procedura `xattr` documentata nella release.
5. GitHub Actions segnala soltanto una deprecazione non bloccante: alcune action basate su Node 20 vengono forzate su Node 24.

## Prossima fase proposta — v1.8 recall delle entità

Obiettivo: aumentare i dati personali proposti automaticamente senza indebolire la precisione, la privacy dei log o la pipeline PDF.

Ordine consigliato:

1. Creare `feat/ner-recall-v18` dalla tip corrente di `feat/ocr-cache-layer-v17`, verificando che `v1.7.0-beta.1` sia l'antenato immediatamente precedente al solo handoff documentale; non lavorare su `master` e non spostare il tag.
2. Scaricare e installare il DMG arm64 della beta, eseguire uno smoke su documento sintetico e sul caso manuale già verificato. Se la dimensione resta ragionevole, documentare evidenza e chiudere #21.
3. Costruire un corpus esclusivamente sintetico di falsi negativi rappresentativi di atti e documenti amministrativi italiani: nomi spezzati, intestazioni, tabelle, etichette `Cognome/Nome`, indirizzi, date e luoghi di nascita, datore/dipendente, varianti OCR e righe isolate.
4. Introdurre metriche aggregate di precision/recall/F1 per tipo, senza testo personale nei log e senza persistenza degli artefatti OCR.
5. Diagnosticare separatamente regex, BERT, co-reference, normalizzazione OCR e layer LLM. Correggere prima le cause misurabili; non aggiungere regex larghe prive di contesto.
6. Aggiungere regression test per ogni falso negativo corretto e budget esplicito sui falsi positivi.
7. Verificare che entità manuali/importate continuino a funzionare nel singolo e nel batch e che il ledger produca `partial` quando una decisione non trova rettangoli.
8. Eseguire tutti i gate v1.7 invariati prima di qualsiasi nuova beta.

## Prompt pronto per la nuova conversazione

```text
Lavora nel repository /Users/filippostrozzi/Documents/Sviluppo App/anonimator.

Leggi integralmente CLAUDE.md e sessioni/sessione_054_handoff_v18.md, poi verifica Git, tag, release e baseline senza assumere che lo stato remoto sia invariato.

Avvia la fase v1.8 dedicata al recall delle entità. Crea la branch feat/ner-recall-v18 dalla tip aggiornata di feat/ocr-cache-layer-v17, dopo aver verificato che il tag immutabile v1.7.0-beta.1 ne sia antenato e che dopo il tag vi siano soltanto commit di handoff documentale. Prima esegui il P0 indicato nell'handoff: smoke della build macOS arm64 pubblicata e verifica dell'issue #21; chiudila solo con evidenza sufficiente.

Poi costruisci un corpus ed evaluation sintetici per i falsi negativi NER/OCR osservati su documenti legali e amministrativi italiani, misura precision/recall/F1 per tipo e implementa miglioramenti mirati senza registrare o versionare dati personali. Mantieni congelati trust boundary e pipeline PDF fail-closed salvo regressioni riproducibili. Esegui tutti i gate v1.7 obbligatori e aggiungi test per ogni correzione.

Puoi usare fino a tre subagenti in parallelo, con ownership esclusiva dei file condivisi. Parti con un audit breve e un piano esecutivo red-teamed, quindi procedi autonomamente con implementazione e verifica. Non pubblicare una nuova release e non promuovere la beta a stabile senza una mia richiesta esplicita.
```
