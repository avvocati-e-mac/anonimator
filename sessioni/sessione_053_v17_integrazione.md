# Sessione 053 — integrazione v1.7

> Stato storico precedente alla pubblicazione. Per lo stato corrente e la prossima fase vedere `sessione_054_handoff_v18.md`.

Data: 2026-09-11

## Stato

- Branch v1.6 verificata: `release/v1.6.0-beta.2` su `5aa192a`.
- Branch v1.7 beta: `feat/ocr-cache-layer-v17`, versione `1.7.0-beta.1`.
- Al momento di questa integrazione il ritiro remoto e il force-push erano pendenti; sono stati completati nella sessione 054 dopo il ripristino dell'autenticazione GitHub.
- Nessuna promozione stabile eseguita: resta obbligatoria la finestra di sette giorni senza P0/P1 e lo smoke test dei pacchetti sulle tre piattaforme.

## Integrazione v1.7

- Una sola chiamata `Tesseract.recognize` per pagina, nel parser OCR.
- Artefatto ridotto in RAM legato all'analysis token, budget globale 128 MiB, nessun TTL o persistenza.
- Riutilizzo dei bbox OCR con trasformazione completa matrice/origine; assenza dell'artefatto significa hard failure.
- Noto Sans incorporato tramite fontkit e testo con rendering invisibile PDF `Tr 3`.
- Layer ricercabile soltanto per output `complete`; gli output parziali restano raster-only.
- Font e licenza OFL inclusi fra le risorse di packaging.

## Gate eseguiti

- `npm run typecheck:all`: verde.
- `npm run ui:build`: verde.
- `npm run test:unit`: 35 file, 536 test verdi.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:roundtrip`: 60 PDF, 365 parole OCR reali, nessuna anomalia.
- `npm run test:pixel-leak`: 2 test verdi.
- `npm run test:searchable-pdf`: 3 test verdi.
- `npm run test:pdf-rss`: verde, RSS stabile a circa 131,8 MiB.

## Vincoli di rilascio ancora aperti

1. Ripristinare `gh auth`.
2. Ritirare gli asset della beta.1 secondo la mutabilità effettiva della release e pubblicare l'avviso.
3. Eseguire il force-push con `--force-with-lease` contro lo SHA remoto verificato e controllare tutte le ref.
4. Lasciare completare il job anti-segreti sulla cronologia sanificata.
5. Eseguire packaging e smoke test su macOS, Windows e Linux; poi osservare sette giorni senza P0/P1 prima della promozione stabile.
