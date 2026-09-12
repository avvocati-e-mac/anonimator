# Sessione 066 — Icone attività durante l'elaborazione

## Obiettivo

Rendere riconoscibile a colpo d'occhio l'attività in corso, con particolare evidenza per il riconoscimento OCR, senza modificare trust boundary o pipeline PDF fail-closed.

## Modifiche

- Aggiunto lo stage IPC `output` per distinguere la generazione del documento anonimizzato dalla lettura iniziale.
- Propagato lo stage tipizzato dal Main al preload, al Renderer e allo store Zustand.
- Aggiunto `ProgressActivityIcon`, condiviso dai flussi singolo e batch.
- Associazioni visuali:
  - lettura documento → file con lente;
  - OCR → scansione del testo;
  - NER → circuito neurale;
  - anonimizzazione/output → file protetto;
  - completamento → spunta verde.
- Titolo della schermata sincronizzato con l'attività corrente; icone etichettate per l'accessibilità.

## Sicurezza e privacy

La modifica riguarda soltanto metadati di avanzamento a insieme chiuso. Nessun contenuto del documento, dato personale o nuovo accesso al filesystem viene acquisito, registrato o versionato. Trust boundary e comportamento fail-closed dei PDF restano invariati.

## Test

- Test unitario della mappatura completa stage → attività → etichetta.
- Typecheck e build Renderer/Main.
