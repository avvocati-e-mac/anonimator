# Sessione 062 — Fix geometria immagini standalone
**Data:** 2026-09-11
**Versione:** 1.8.0 (sviluppo post-release, nessun bump)

## Obiettivo

Avviare la fase DPI con audit parallelo e correggere prima un difetto fail-closed
emerso nel percorso immagini standalone.

## Orchestrazione e finding

- Tre subagenti hanno verificato in parallelo configurazione DPI/call graph,
  disegno del benchmark sintetico e trust boundary.
- `parseImage()` passava a Tesseract il raster originale ma registrava una matrice
  `dpi / 72`; con il default 300 i bbox venivano quindi ridotti di circa 4,17 volte
  durante l'inversione geometrica.
- `generateImagePdfSafe()` incapsula invece l'immagine con il contratto storico
  `1 pixel = 1 punto`. Il ledger poteva contare la redazione applicata nel posto
  sbagliato come completata, senza che la validazione globale dell'inchiostro la
  rilevasse.

## Correzione

- Aggiunta `buildImagePixelMatrix()`, che restituisce la matrice identità.
- `parseImage()` usa ora questa matrice per l'artefatto OCR. Il DPI resta un hint
  inviato a Tesseract e non viene confuso con una trasformazione geometrica.
- Nessuna modifica al percorso PDF, al default 300 DPI, al routing, ai token o al
  ledger.

## Test

- Il contratto puro verifica che la matrice resti identità indipendentemente
  dall'hint DPI.
- Un test con worker OCR mockato attraversa `parseImage()` e verifica la matrice e
  i bbox realmente registrati nell'artefatto token-bound.
- Il gate pixel-leak costruisce una PNG temporanea con pattern e testo totalmente
  sintetici, lega un artefatto a un token e salva tramite l'entry point pubblico.
- Il test controlla ledger `complete`, eliminazione dei pixel nella regione esatta,
  copertura di tutte le bande del bbox, conservazione di una regione di controllo
  e layer ricercabile contenente soltanto lo pseudonimo sintetico.
- Fixture e output sono creati in una directory temporanea e rimossi in `finally`.

## Invarianti

- Trust boundary e pipeline PDF fail-closed invariati.
- Nessun dato personale acquisito, registrato o versionato.
- Nessun tag, push o rilascio.

## Verifiche

- `git diff --check`: verde.
- `npm run typecheck:all`: verde.
- `npm run ui:build`: verde.
- Test mirati OCR/pixel/searchable: 23 test verdi.
- `npm run test:unit`: 41 file, 577 test verdi.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:pixel-leak`: coperto nella passata mirata, 3 test verdi.

## Prossima unità

Prima del benchmark DPI completo, valutare il preflight del budget pixel prima di
`toPixmap` e il comportamento fail-closed di `scan-no-text`; l'audit ha rilevato
che oggi un errore di rendering OCR può degradare a testo digitale vuoto.
