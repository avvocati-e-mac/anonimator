# Sessione 065 — Prototipo output bitonale conservativo
**Data:** 2026-09-11
**Versione:** 1.8.0 (sviluppo post-release, nessun bump)

## Obiettivo

Introdurre un prototipo di produzione esclusivamente Main e opt-in per codificare
come raster bitonale le sole pagine scan strettamente idonee, senza
modificare UI, IPC, routing, ledger o comportamento JPEG predefinito.

## Decisioni prese

- `SafePdfOptions.rasterCodec` accetta internamente `jpeg` oppure
  `bitonal-auto`; l'assenza dell'opzione mantiene JPEG qualità 85.
- L'idoneità viene ricalcolata sull'esatto raster DeviceRGB prodotto da MuPDF.
  L'opt-in richiede inoltre una `pageSafety` completa e biunivoca rispetto alle
  pagine del documento; se manca o è incoerente l'intero documento resta JPEG.
  Pagine digitali e `page-error` sono escluse; colore coerente, tratti sbiaditi
  localizzati, bassa separabilità, toni ambigui e frazioni d'inchiostro estreme
  mantengono JPEG.
- Il selettore usa una policy iniziale volutamente estrema: qualunque pixel con
  delta cromatico `max-min > 24` oppure luma nella fascia assoluta `33..222`
  mantiene JPEG. Solo raster sostanzialmente bianco/nero puro proseguono alle
  ulteriori soglie Otsu (separabilità almeno 0,90, banda ambigua al massimo 1%
  e inchiostro fra 0,2% e 35%). Rumore, JPEG e antialiasing possono quindi
  rimanere conservativamente esclusi.
- Il raster idoneo viene prima redatto e soltanto dopo impacchettato MSB-first
  come `/DeviceGray`, `/BitsPerComponent 1`, `/FlateDecode`. La conversione
  RGB→1 bit è distruttiva; Flate comprime senza perdita soltanto il bitmask già
  quantizzato. Il codec non riceve stream o oggetti della sorgente.
- L'inidoneità attesa usa il percorso JPEG esistente. Errori tecnici di
  compositing, packing, embedding o validazione interrompono invece la
  generazione senza fallback e senza file finale.
- La validazione atomica confronta il ledger codec con il numero di pagine e,
  sullo stesso XObject bitonale, verifica dizionario, dimensioni, Decode,
  payload decodificato, stride atteso e hash del bitmask prodotto in RAM.
- La pixmap DeviceRGB viene accettata solo con lunghezza coerente allo stride;
  l'eventuale padding di riga viene ricopiato in un buffer tight controllato.
- Il layer ricercabile resta consentito soltanto per output `complete`; gli
  output `partial` restano raster-only.
- CCITT G4 non è stato introdotto: l'helper TIFF delle fixture ha vincoli e
  complessità non adatti al runtime. Flate comprime senza perdita il bitmask
  1-bit già quantizzato ed è più semplice e verificabile senza nuova dipendenza.
- Il vantaggio dimensionale è verificato soltanto sulla fixture bianco/nero
  grande e deterministica condivisa dal test automatico e dal pacchetto manuale:
  dalla stessa sorgente si producono JPEG default e bitonale, richiedendo un
  rapporto inferiore a 0,60. La soglia non si applica a pagine piccole o ai
  fallback JPEG e la leggibilità rimane un controllo visivo, senza OCR flaky.

## File modificati

- `src/main/services/bitonalCodec.ts`
- `src/main/outputGenerators/pdfSafeGenerator.ts`
- `tests/bitonalCodec.test.ts`
- `tests/bitonalPdf.test.ts`
- `tests/helpers/bitonalManualFixtures.ts`
- `tests/manual/bitonalManual.test.ts`
- `tests/searchablePdfGate.test.ts`
- `scripts/manual-bitonal.mjs`
- `CLAUDE.md`
- `GUIDA.md`
- `.gitignore`
- `package.json`
- `vitest.config.ts`
- `sessioni/sessione_065_prototipo_output_bitonale.md`

## Verifiche

- `npm run typecheck:all`: verde.
- `npm run test:unit`: 45 file verdi, 622 test verdi; un benchmark opzionale
  correttamente saltato.
- Test mirati bitonali: 30 test verdi fra selector, packing, stride RGB,
  struttura e payload dello stesso XObject PDF, fallback conservativi, mixed
  codec, sanitizzazione, failure cleanup, pixel extraction, confronto
  dimensionale e searchable layer.
- `npm run test:pixel-leak`: 3 test verdi.
- `npm run test:searchable-pdf`: 3 test verdi.
- `npm run test:corpus`: 57 test verdi.
- `npm run test:roundtrip`: 60 casi verdi, nessuna anomalia.
- `npm run test:pdf-rss`: verde, plateau finale 131,7-131,8 MiB.
- `npm run ui:build`: verde.
- Fixture dimensionale 1400×1800: gate rapporto bitonale/JPEG inferiore a 0,60 verde;
  rapporto osservato circa 0,00455 rispetto al JPEG default.
- `npm run manual:bitonal`: verde; quattro fixture sintetiche, PDF e anteprime
  PNG prodotti in una nuova directory locale ignorata da Git. Il report contiene
  soltanto esiti aggregati e la checklist non include testo documentale.

## Controllo manuale dev-only

`npm run manual:bitonal` verifica prima la presenza di `pdfimages` e
`pdftoppm`, poi esegue un harness Vitest escluso dai gate ordinari. Il comando
non accetta documenti esterni e genera da zero quattro casi:

1. bianco/nero puro e grande, che deve produrre un XObject bitonale; dalla
   stessa sorgente viene prodotto anche il JPEG default e il rapporto dei byte
   deve essere inferiore a 0,60;
2. tratto grigio luma 180, che deve restare JPEG e visibile;
3. segno scuro `[0, 0, 100]`, che deve restare JPEG e cromatico;
4. redazione completa con layer ricercabile, nella quale il token sintetico deve
   essere assente e lo pseudonimo presente.

Gli oracoli automatici devono passare prima che vengano scritti `report.json` e
`README.md`. Ogni run crea una sottodirectory distinta sotto
`manual-test-output/` senza cancellare run precedenti e senza aprire GUI. Lo
stdout dello script contiene soltanto il codice fisso di successo e il percorso
locale della directory; gli errori usano codici fissi.

## Problemi noti / TODO prossima sessione

- Il prototipo non è esposto via UI o IPC e quindi non cambia ancora il prodotto.
- Le soglie devono restare conservative finché un corpus sintetico più ampio non
  dimostra che possono essere modificate senza perdita di firme, timbri, testo
  sbiadito o altri dettagli probatori.
- Ampliare in futuro le forme sintetiche prima di generalizzare il rapporto
  dimensionale e mantenere un confronto RSS dedicato fra codec. Valutare CCITT
  G4 soltanto come unità successiva separata.
