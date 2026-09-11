# Corpus OCR — PDF di riferimento per il controllo del layer di testo

Corpus sintetico e deterministico usato per tarare e testare
`src/main/services/ocrLayerCheck.ts`, il motore che stabilisce se un PDF è una
**scansione con layer di testo OCR** e se quel layer è **allineato ai pixel**
dell'immagine.

Il test che lo esercita è `tests/ocrCorpus.test.ts`: 56 casi, ~2,2 s.

## Tutti i dati sono finti

Ogni fixture contiene solo nomi manifestamente inventati (`Mario Rossi`,
`Giulia Bianchi`, `RSSMRA80A01H501U`, `Cittafinta`, `Via delle Fixture`),
nella convenzione già usata nel resto del progetto. **Nessun dato reale, e
nessun dato plausibile di persone esistenti.** Il corpus vive in un repository:
se contenesse dati personali sarebbe un problema creato proprio dallo strumento
che serve a evitarli. Il test verifica anche che quei nomi non compaiano mai nel
report prodotto dal motore.

## Rigenerare

```bash
node tests/corpus-ocr/generate.mjs              # tutto tranne roundtrip/
node tests/corpus-ocr/generate.mjs --roundtrip  # include l'OCR reale (lento)
node tests/corpus-ocr/verify.mjs                # controlla che i PDF siano leggibili
```

`verify.mjs` è un controllo **strutturale approssimativo** (il PDF si apre, ha
pagine, blocchi immagine e righe di testo, e una copertura grossolana). Le sue
soglie sono indicative: segnala fisiologicamente i PDF digitali senza immagine,
le pagine rade e le fixture disallineate per costruzione. **L'oracolo
autorevole è `tests/ocrCorpus.test.ts`**, che asserisce i verdetti del motore
vero; `verify.mjs` serve solo a scoprire in fretta un PDF prodotto male.

I raster sono **disegnati programmaticamente** (righe di testo come barrette a
passo noto, con lunghezze variabili e rientri), non fotografati: serve ground
truth esatta al punto, file piccoli e riproducibilità bit per bit. Il layer di
testo è posato con render mode 3 (invisibile), come in un vero sandwich OCR.

## Catalogo

### `negativi/` — non devono generare alcun allarme

È il gruppo più importante: qui si misurano i **falsi positivi**, e la
tolleranza è zero. Un rilevatore che grida al lupo diventa un rilevatore che si
ignora.

| File | Difetto simulato | Atteso | Perché c'è |
|---|---|---|---|
| `neg-01-digitale-nativo` | nessuno, PDF digitale puro | `digital` / `inconclusive` | il controllo non si applica |
| `neg-02-allineato-flate` | nessuno, immagine Flate | `aligned` | caso base |
| `neg-03-allineato-jpeg` | nessuno, DCTDecode | `aligned` | decodifica JPEG scalata |
| `neg-05-slop-3pt` | scarto verticale 3pt | `aligned` | sotto la tolleranza di redazione |
| `neg-06-glyphless` | font `GlyphLessFont` | `aligned` | firma del sandwich Tesseract |
| `neg-07-timbro` | timbro e firma sovrapposti | `aligned` | prova del **lift** |
| `neg-08-tabella-densa` | griglia a filetti pieni | `aligned` | i filetti non devono far crollare `lineAgreement` |
| `neg-09-carta-grigia` | fondo grigio uniforme | `aligned` | prova della soglia su moda della carta invece che Otsu |
| `neg-10-due-colonne` | layout a due colonne | `aligned` | `lineAgreement` deve guardare solo la finestra x della riga |
| `neg-11-quasi-vuota` | frontespizio, 5 parole | `inconclusive` | astensione, non accusa |
| `neg-12-pagina-scura` | foto a piena pagina | `inconclusive` | astensione |
| `neg-13-misto` | pag.1 nativa, pag.2 scansione | `aligned` | documento ibrido |
| `neg-14-margini-bianchi` | scansione più piccola della pagina | `aligned` | la pagina di coda è rada: `fitScaleY` deve astenersi |

### `geometrici/` — devono essere tutti rilevati

| File | Difetto |
|---|---|
| `geo-01-dy-6pt` · `geo-02-dy-20pt` · `geo-03-dx-15pt` · `geo-04-diagonale` | traslazioni |
| **`geo-05-una-riga`** | **scarto pari a esattamente un'interlinea** |
| `geo-06-due-righe` | scarto di due interlinee |
| `geo-07-scala-200-300` | layer a 200 DPI su pagina a 300 (fattore 1,5) |
| `geo-08-scala-1pct` | deriva dell'1%: perfetto in cima, ~8pt in fondo |
| `geo-09-cropbox` · `geo-10-mediabox-origine` | riferimenti di pagina discordanti |
| `geo-11-rotate-90` · `geo-12-rotate-180` | `/Rotate` applicato solo all'immagine |
| `geo-13-capovolto` | layer capovolto — difetto ScanSnap/ABBYY documentato |
| `geo-14-specchiato` | coordinate x speculari |
| `geo-15-deskew` | immagine raddrizzata, layer alle posizioni precedenti |
| `geo-16-obliqua` | scansione storta di 3°, layer dritto |
| `geo-17-userunit` | `/UserUnit` ≠ 1 |
| `geo-18-pagina-sfasata` | layer della pagina N sulla N+1 |
| `geo-19-blocco-unico` | tutto il testo in un blocco all'origine |
| `geo-20-solo-prima-pagina` | layer OCR solo su pag.1 di 3 |

**`geo-05-una-riga` è il caso che giustifica l'intera metrica `lineAgreement`.**
Uno scarto di esattamente un'interlinea lascia la coverage altissima — il testo
cade sull'inchiostro della riga *adiacente*, che inchiostro ce l'ha — ed è il
disallineamento più pericoloso, perché si redige la riga sbagliata. Solo il
confronto per riga (estensione orizzontale e numero di parole) se ne accorge.
Se un giorno questo test diventa rosso, il motore ha un punto cieco grave.

Due fixture di questo gruppo sono state **corrette in fase di taratura** perché
il difetto non era osservabile per costruzione: `geo-18` ripeteva tre volte lo
stesso testo, e spostare il layer di una pagina su pagine identiche non cambia
nulla. Ora usa `variedBlocks`, che varia il contenuto **dall'inizio** di ogni
pagina. È un errore facile da rifare: una fixture deve rendere il difetto
*misurabile*, non solo presente.

### `immagine/` — qualità del raster e casi rilevanti per la redazione

| File | Caso | Atteso |
|---|---|---|
| `img-01-dpi-300` | raster nativo a 300 DPI | qualità `good` |
| `img-02-dpi-150` | raster nativo a 150 DPI | qualità `marginal` |
| `img-03-dpi-100` | raster nativo a 100 DPI | qualità `poor` |
| `img-04-contrasto-basso` · `img-05-illuminazione` | inchiostro debole, gradiente | `aligned` |
| `img-06-inclinata-3gradi` | scansione storta, layer dritto | `misaligned` |
| `img-07-sfocata` | raster sfocato | `aligned` |
| `img-08-mrc` | pagina in più XObject | `aligned` |
| `img-09-strisce` | pagina in 12 strisce | `aligned` |
| `img-10-ctm-ruotato` | immagine con CTM ruotato | `misaligned` |
| `img-11-smask` · `img-12-indexed` | maschera morbida, spazio colore Indexed | `aligned` |
| `img-13-xobject-condiviso` | stessa immagine su due pagine | `aligned` |
| `img-14-g4-grande` | CCITT G4 bilivello | `aligned` |

Le soglie di `img-02` e `img-03` non sono arbitrarie: la documentazione di
Tesseract indica l'**altezza della x in pixel** come diagnostica, e colloca
sotto i 10px la soglia oltre la quale ci sono «pochissime probabilità di
risultati accurati». A 150 DPI una riga da 10pt sta appunto sui 10px.

`img-07-sfocata` esiste per verificare il contrario di quanto ci si aspetta:
**la sfocatura da sola non deve generare un allarme.** Le soglie di sfocatura
che circolano vengono da articoli su fotografie naturali, e la letteratura
mostra che le metriche generiche di qualità immagine non predicono l'errore OCR.
Il segnale pesa solo insieme a DPI nativo e altezza della x.

`img-14-g4-grande` è stato corretto in taratura: la polarità era invertita
(`/BlackIs1`), la pagina renderizzava per l'89% nera e il motore correttamente
si asteneva con `dark-page`. Il caso è importante perché **il G4 è il formato
dominante negli allegati PEC e nell'output degli MFP italiani**: un rilevatore
cieco sul G4 sarebbe cieco proprio sui documenti più comuni.

### `testo/` — difetti di codifica

Geometria sana, testo inservibile. A coglierli è il punteggio linguistico di
`src/main/services/textQuality.ts`, non quello geometrico.

| File | Difetto | Geometria | Qualità testo |
|---|---|---|---|
| `txt-01-no-tounicode` | font senza `/ToUnicode` | `misaligned` | `poor` |
| `txt-02-pua` | glifi su Private Use Area | `misaligned` | `good` * |
| `txt-03-fffd` | caratteri di sostituzione | `aligned` | `poor` |
| `txt-04-lingua-sbagliata` | OCR in un'altra lingua | `aligned` | `suspect` |
| `txt-05-caratteri-isolati` | ogni lettera separata | `misaligned` | `poor` |
| `txt-06-testo-visibile` | `Tr` non impostato a 3 | `aligned` | `good` |
| `txt-07-doppio-layer` | OCR eseguito due volte | `aligned` | `good` |

\* Dai glifi PUA non si estrae testo valutabile, quindi il punteggio linguistico
si astiene (`text-too-short`) invece di accusare. Il documento viene comunque
segnalato, per via della geometria.

### `roundtrip/` — OCR reale nel giro

Attualmente **vuoto**: da generare con `--roundtrip`.

Serve a spezzare la circolarità del resto del corpus. Tutte le altre fixture
hanno difetti costruiti da noi, e tarare il rilevatore finché li trova dimostra
poco: un layer sintetico non ha il jitter dei box di un OCR vero, né il rumore
di compressione, né la micro-inclinazione. Il giro previsto è:

```
pagina → raster a 200 DPI con JPEG e rumore → OCR con il tesseract.js del progetto
       → ricostruzione del PDF con quel layer traslato di un offset noto
```

I file vanno generati **una volta e versionati**, non rigenerati a ogni test:
Tesseract non è deterministico fra versioni. Richiede
`~/Library/Application Support/anonimator/tessdata/ita.traineddata`.

### `noti-non-coperti/` — limiti dichiarati, NON regressioni

| File | Perché sfugge |
|---|---|
| `nc-01-xerox-jbig2` | Le cifre sono sostituite **dentro l'immagine** (bug documentato del pattern matching JBIG2 su Xerox WorkCentre/ColorQube). Testo e pixel concordano: sono entrambi sbagliati. **Nessun controllo geometrico può rilevarlo.** |
| `nc-02-layer-incompleto` | Layer perfettamente allineato che però ha saltato un blocco di testo. Il verdetto `aligned` è corretto, ma il nome mancante non verrà mai redatto. Misurare il *recall* del layer richiederebbe un secondo OCR di confronto. |

Questi due casi sono attesi come `aligned`. **Se un giorno risultassero
`misaligned`, non è un miglioramento: è un falso positivo.**

## Struttura

```
generate.mjs   generatore deterministico
verify.mjs     controllo di leggibilità dei PDF prodotti
lib/
  layout.mjs   blocchi di testo e impaginazione (ATTO, variedBlocks, tableBlocks)
  raster.mjs   codifiche immagine (Flate, JPEG, CCITT G4, Indexed, ImageMask)
  pdf.mjs      costruttore PDF grezzo, per i casi fuori portata di pdf-lib
  text.mjs     layer di testo invisibile (render mode 3)
  doc.mjs      assemblaggio del documento
  render.mjs   disegno delle barrette che simulano le righe
```
