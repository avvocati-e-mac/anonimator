# Sessione 059 — Audit post-release v1.8.0
**Data:** 2026-09-11
**Versione:** 1.8.0 stabile

## Obiettivo

Verificare nuovamente lo stato live di Git, tag, release, artefatti e CI dopo la
pubblicazione di v1.8.0; rieseguire la baseline locale e definire l'ordine della
prossima fase senza modificare trust boundary o pipeline PDF fail-closed.

## Decisioni prese

- `master` locale e `origin/master` coincidono sul commit `ee3314346286e481608d802ac355a9d3b6cb7c61`.
- Il tag annotato `v1.8.0` è invariato: tag object `b470cffa541aba6c8e3ebbf91c42fd28841e5daa`,
  dereferenziato al commit `73398771853231dcddf2d20a53d521264ddecb2b`. Il tag non ha firma GPG.
- La release GitHub v1.8.0 è ancora la latest stabile, non draft e non prerelease.
  I quattro artefatti conservano dimensioni e digest SHA-256 documentati nella sessione 058.
- Il workflow del tag `34611067593` e l'ultimo workflow di `master` `34611844115`
  sono conclusi con successo. Resta non bloccante l'avviso Node 20/Node 24 di
  `gitleaks/gitleaks-action@v2`.
- La prossima unità consigliata è il cleanup del codice overlay legacy non
  raggiungibile. Seguono benchmark DPI senza cambio del default, prototipo
  bitonale prudente e firma/notarizzazione come fase release-engineering separata.
- Qualunque miglioramento NER resta subordinato a un falso negativo riproducibile
  con fixture interamente sintetica e relativi negative control.
- Il riferimento a `PROJECT_MASTER v2.1.md`, file non presente nel repository, è
  stato rimosso da `CLAUDE.md`. La documentazione dello stack è stata allineata a
  `electron-vite ^5.0.0` e `Vite ^7.3.1`.
- Nessun tag è stato creato e nessuna release è stata pubblicata.

## File modificati

- `CLAUDE.md`
- `GUIDA.md`
- `sessioni/sessione_059_audit_post_v180.md`

## Verifiche

- `npm run typecheck:all`: verde.
- `npm run ui:build`: verde.
- `npm run test:unit`: 38 file, 588 test verdi.
- `npm run test:ner-recall`: 4 test verdi; 26 TP, 0 FP, 0 FN.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:roundtrip`: 60 PDF, 365 parole OCR reali, nessuna anomalia.
- `npm run test:pixel-leak`: 2 test verdi.
- `npm run test:searchable-pdf`: 3 test verdi.
- `npm run test:pdf-rss`: RSS 131,3–131,4 MiB, stabile.

## Problemi noti / TODO prossima sessione

1. Rimuovere il codice overlay legacy solo dopo avere aggiunto test di
   caratterizzazione sugli entry point pubblici della pipeline PDF.
2. Costruire un benchmark sintetico DPI che misuri recall OCR, geometria,
   dimensione output, tempo e memoria; non cambiare il default 300 senza evidenza.
3. Valutare il bitonale soltanto per pagine documentali idonee, senza introdurre
   fallback e conservando raster-only gli output `_DA_VERIFICARE`.
4. Pianificare firma Developer ID, hardened runtime, notarizzazione e stapling
   solo dopo disponibilità delle credenziali e autorizzazione esplicita ai test CI.
5. Correggere separatamente l'avviso runtime dell'action gitleaks e valutare gli
   altri warning di dipendenze senza mescolarli alla pipeline documentale.
