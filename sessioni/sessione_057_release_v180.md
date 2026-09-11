# Sessione 057 — Release ufficiale v1.8.0

**Data:** 2026-09-11  
**Versione:** 1.8.0

## Obiettivo

Preparare e pubblicare la release stabile v1.8.0 della fase dedicata al recall delle entità, dopo autorizzazione esplicita dell'utente.

## Decisioni prese

- Il miglioramento del recall NER continua oltre la release: la revisione manuale resta necessaria e non viene presentato il riconoscimento automatico come infallibile.
- La capacità di inserimento manuale e rimozione è stata confermata nel test utente; il precedente mancato riscontro dipendeva da un carattere finale omesso nell'entità inserita.
- La release conserva invariati trust boundary, pipeline PDF fail-closed e obbligo di verifica degli output segnalati `_DA_VERIFICARE`.
- La pubblicazione è affidata al workflow GitHub sul tag stabile `v1.8.0`; nessuna promozione automatica di tag beta precedenti.

## File modificati

- `package.json`, `package-lock.json`: versione 1.8.0.
- `CHANGELOG.md`: chiusura della sezione 1.8.0.
- `GUIDA.md`: versione documentata aggiornata.
- `sessioni/sessione_057_release_v180.md`: handoff della release.

## Problemi noti / TODO prossima sessione

- Ampliare progressivamente il corpus sintetico quando emergono falsi negativi riproducibili, senza acquisire né versionare dati personali.
- Verificare gli output marcati `_DA_VERIFICARE`; la segnalazione fail-closed indica che è richiesto controllo manuale.
