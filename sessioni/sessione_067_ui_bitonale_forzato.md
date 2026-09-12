# Sessione 067 — Scelta UI per output bitonale forzato

## Obiettivo

Offrire all'utente una scelta esplicita tra PDF a colori e PDF compatto in bianco e nero, includendo anche gli ingressi PNG/JPG, senza indebolire trust boundary o pipeline PDF fail-closed.

## Comportamento

- `preserve-color` è il default e mantiene JPEG colore qualità 85.
- `force-bitonal` converte irreversibilmente le pagine scan e le immagini a DeviceGray 1-bit.
- La UI descrive la possibile perdita di colori, timbri, firme chiare, evidenziature, fotografie e testo sbiadito; il pulsante resta disabilitato finché l'utente non conferma di aver compreso.
- Il contratto IPC accetta soltanto i due valori semantici. Soglie e nomi dei codec interni non sono accettati dal Renderer.
- Il Main ricalcola e verifica la provenienza delle pagine. Provenienza incompleta, `page-error` o errori di selezione, packing, embedding e validazione interrompono la scrittura senza fallback.
- `bitonal-auto` resta interno ai test/harness conservativi e non rappresenta la scelta forzata dell'utente.

## Privacy

La preferenza è un enum non sensibile. Nessun testo OCR, immagine, percorso o dato personale aggiuntivo viene registrato o versionato.

## Verifica eseguita

- Versione applicativa invariata: `1.8.0`; sviluppo locale sul branch `refactor/pdf-overlay-cleanup`, senza tag, release o push.
- Percorso UI reale su Electron dev con `verbale_24pt_05_copia_di_copia.png`: OCR completato, selettore visibile, consenso obbligatorio e output PDF verificato come singolo raster Gray/BPC1 con `/FlateDecode` e layer ricercabile.
- Audit OCR reale su dieci pagine sintetiche rappresentative, senza persistere il testo riconosciuto. Escludendo il controllo dichiarato illeggibile: recall medio delle sequenze sensibili 0,857, token recall 0,935, WER 0,173 e CER 0,044. Il controllo illeggibile ha prodotto warning e recall sensibile 0, come atteso.
- Matrice PDF A4 derivata a 150/200/300/400 DPI: 150 mostra l'avviso di bassa risoluzione e propone 200 DPI OCR; 200, 300 e 400 risultano `good`. È stato corretto il caso image-only, che prima non misurava il raster, e il calcolo ora è invariante per rotazioni di 90°.
- Test automatici coprono schema IPC, mapping semantico Main, default colore, pagina/PNG forzati, struttura Gray/BPC1, redazione prima del packing, `page-error`, provenance incompleta e failure injection senza output o temporanei.

Gate finali verdi: `typecheck:all`; unit suite (50 file, 644 test, 1 suite/1 test intenzionalmente skipped); corpus interno (57); pixel-leak (3); searchable PDF (3); roundtrip OCR reale (60 fixture, 4 roundtrip); RSS; build Electron/Vite; harness manuale bitonale (`MANUAL_BITONAL_OK`).

## Corpus consigliato per prova manuale

1. `verbale_24pt_00_originale` — controllo positivo pulito.
2. `verbale_24pt_02_fotocopia_chiara` — degrado lieve, confronto quasi ideale.
3. `verbale_24pt_05_copia_di_copia` — caso realistico già validato end-to-end nella UI.
4. `verbale_24pt_06_pessima` — iniziano falsi negativi OCR riproducibili.
5. `verbale_24pt_07_illeggibile_attesa` — verifica che l'app avvisi e non ispiri falsa fiducia.
6. `verbale_24pt_10_righe_verticali` — robustezza rispetto agli artefatti lineari.
7. `verbale_24pt_12_rilegatura_scia` — degrado localizzato e errori di parola.
8. `verbale_24pt_13_fotocopia_disastrosa` — stress test più discriminante.
9. `decreto_24pt_06_pessima` — stesso livello di degrado con struttura di atto diversa.

## Lacune utili del corpus

Il corpus è una base evolutiva, non una baseline immutabile. Mancano soprattutto documenti con testo realistico 8–12 pt, timbri/firme/evidenziature realmente colorati, fotografie, JPEG e PNG equivalenti, rotazione EXIF/alpha/CMYK, pagine tagliate o inclinate, tabelle e colonne, e PDF multipagina con colore e DPI misti (120/150/200/300/400). Questi casi sono più utili di nuove varianti quasi duplicate per valutare UI, avvisi e perdita informativa del bitonale.
