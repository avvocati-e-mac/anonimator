<p align="center">
  <img src="build-resources/anonimator.png" alt="Icona ufficiale di Anonimator: un robot arancione con maschera" width="180">
</p>

<h1 align="center">Anonimator</h1>

<p align="center"><strong>Pseudoanonimizzazione locale di documenti legali, con revisione del professionista.</strong></p>

Anonimator è un’app desktop che aiuta a **pseudoanonimizzare documenti legali in locale**. Individua nomi e altri dati da proteggere, li sottopone alla revisione dell’utente e crea una nuova copia del documento con pseudonimi coerenti.

È pensata per avvocati e professionisti che non vogliono caricare gli atti su un servizio cloud. L’analisi ordinaria avviene sul computer; la connessione Internet serve per scaricare i modelli al primo utilizzo. È possibile aggiungere un modello linguistico locale, come Ollama o LM Studio, ma non è obbligatorio.

**Versione pubblicata: 1.8.0.** Nel codice è in preparazione la 1.9.0, che aggiunge la ricerca verificata nel documento descritta più avanti.

> Anonimator è uno strumento di supporto, non un controllo automatico definitivo. Il riconoscimento può omettere dati o proporre elementi non sensibili. Prima di comunicare, produrre o depositare il file, un professionista deve sempre verificare sia l’elenco delle entità sia il documento risultante.

## Indice

- [Come lavora, in breve](#in-breve-come-lavora)
- [Dati che può riconoscere](#che-cosa-riconosce)
- [Revisione e pseudonimi](#revisione-e-pseudonimi)
  - [Aggiunta verificata dal documento (sviluppo 1.9.0)](#aggiunta-verificata-dal-documento--sviluppo-190)
- [Formati supportati e nota importante sui DOCX](#formati-supportati)
- [PDF scansionati, OCR e sicurezza dell’output](#pdf-scansionati-ocr-e-sicurezza-delloutput)
  - [Aspetto a colori o bianco e nero](#aspetto-a-colori-o-bianco-e-nero)
- [Privacy e trattamento locale](#privacy-che-cosa-resta-locale)
- [Installazione della versione 1.8.0](#installazione-della-versione-180)
  - [macOS](#macos)
  - [Windows](#windows)
  - [Linux](#linux)
- [Uso essenziale](#uso-essenziale)
- [Limiti da conoscere](#limiti-da-conoscere)
- [Sviluppo assistito da IA agentica](#sviluppo-assistito-da-ia-agentica)
- [Informazioni per sviluppatori](#per-sviluppatori)
- [Licenza](#licenza)

## In breve: come lavora

1. Si trascina uno o più documenti nell’app.
2. Anonimator estrae o riconosce il testo e propone i dati potenzialmente identificativi.
3. L’avvocato sceglie cosa trattare, corregge eventuali errori e controlla gli pseudonimi.
4. L’app crea una nuova copia; l’originale non viene modificato.
5. L’avvocato apre il risultato e lo controlla pagina per pagina, con particolare attenzione agli eventuali avvisi.

La **pseudoanonimizzazione** non equivale all’anonimizzazione definitiva: chi dispone del dizionario di corrispondenza, o di altre informazioni, può ricondurre uno pseudonimo alla persona originaria. Il file JSON esportato e la sessione salvata devono quindi essere custoditi come materiale riservato.

## Che cosa riconosce

Anonimator combina regole dedicate ai documenti italiani, un modello NER locale (un sistema che riconosce nomi ed entità nel testo) e, facoltativamente, un modello linguistico locale.

Può proporre, tra gli altri:

- persone, cognomi, soprannomi e riferimenti successivi alla stessa persona;
- luoghi, indirizzi, residenza, luogo e data di nascita;
- codici fiscali, partite IVA, IBAN, email e numeri di telefono;
- targhe e numeri di documento;
- organizzazioni, aziende e datori di lavoro.

Nei moduli riconosce anche campi accompagnati da etichette come “Cognome”, “Nome” o “Dipendente”. Dalla 1.8.0 tollera alcune comuni confusioni dell’OCR fra lettere e numeri e usa il contesto per ridurre falsi riconoscimenti di targhe e partite IVA.

Le organizzazioni individuate automaticamente sono normalmente **deselezionate**: sta all’utente decidere se debbano essere pseudoanonimizzate. Anche tutte le altre proposte devono essere controllate.

## Revisione e pseudonimi

Nella schermata di revisione è possibile:

- includere o escludere ogni entità;
- correggere il testo originale da cercare;
- cambiare il tipo di dato;
- modificare lo pseudonimo proposto;
- aggiungere un dato non riconosciuto automaticamente;
- esportare e importare un dizionario JSON;
- salvare la sessione e riutilizzare gli stessi pseudonimi su documenti della medesima pratica.

Le occorrenze dello stesso nome vengono ricondotte, quando possibile, allo stesso pseudonimo. Nel lavoro su più file l’app presenta un elenco unificato, così la scelta può essere fatta una volta sola per l’intero gruppo.

Altre funzioni pratiche:

- una schermata iniziale spiega i tre livelli di riconoscimento e i requisiti dell’eventuale LLM locale;
- il tema chiaro o scuro viene ricordato dall’app;
- l’avanzamento distingue lettura, riconoscimento OCR, analisi delle entità e creazione dell’output;
- durante la creazione di una scansione l’app chiarisce che riusa l’OCR già in memoria: non sta riconoscendo inutilmente il testo una seconda volta;
- la schermata finale riporta file e pagine elaborati, durata e velocità;
- dalle Impostazioni si possono controllare e scaricare i modelli mancanti e copiare una diagnostica essenziale.

### Aggiunta verificata dal documento — sviluppo 1.9.0

Per PDF e immagini che dispongono di una trascrizione OCR, il pulsante **Aggiungi** apre una modalità più controllabile:

- si consulta la trascrizione, pagina per pagina;
- si selezionano una o più parole e si usa **Usa selezione**;
- l’app cerca le corrispondenze esatte nell’intero documento e ne mostra il numero;
- si può scorrere ogni occorrenza e, su richiesta, vedere la pagina completa con l’area evidenziata;
- solo dopo il controllo si aggiunge l’entità alla revisione.

La selezione viene estesa alle **parole OCR intere**. Se si modifica a mano il testo dopo averlo selezionato, la selezione precedente viene invalidata e il valore è trattato come nuovo testo digitato. Eventuali proposte di nome più completo sono soltanto suggerimenti adiacenti: non vengono scelte automaticamente. Per esempio, cercando “Carlo” l’app può proporre “Carlo Alberto Ruggeri”; non trasforma invece “Carlo Ruggeri” in una corrispondenza che salta la parola “Alberto”.

Limiti attuali:

- la funzione verificata richiede parole e posizioni prodotte dall’OCR; per DOCX, ODT, TXT e Markdown resta disponibile l’aggiunta manuale ordinaria;
- errori OCR, parole fuse o grafie diverse possono impedire una corrispondenza esatta;
- l’anteprima grafica carica una sola pagina per volta ed è un’immagine JPEG ridimensionata: serve a orientarsi, non sostituisce il controllo del file finale;
- se l’immagine di anteprima non può essere generata, la trascrizione e la verifica testuale restano utilizzabili;
- il copia e incolla usa gli appunti gestiti dal sistema operativo, che sono esterni al perimetro di protezione dell’app.

## Formati supportati

| Ingresso | Risultato |
|---|---|
| PDF digitale | Nuovo PDF pseudoanonimizzato |
| PDF scansionato o misto | Nuovo PDF ricostruito pagina per pagina |
| Immagine PNG, JPG o JPEG | Nuovo PDF ricostruito dall’immagine |
| DOCX | Nuovo DOCX |
| ODT | Nuovo ODT |
| TXT | Nuovo TXT |
| Markdown (`.md`) | Nuovo file Markdown |

È possibile elaborare più file insieme e revisionare le entità in un’unica schermata. La resa dei formati modificabili, specialmente DOCX e ODT complessi, deve essere confrontata con l’originale.

> **NOTA IMPORTANTE PER I FILE DOCX (MICROSOFT WORD)**
>
> Microsoft Word può suddividere internamente una parola o una frase in più frammenti, anche quando sullo schermo il testo appare continuo. Formattazione, revisioni e altri elementi del documento possono quindi rendere meno affidabili l’individuazione e la sostituzione diretta delle entità in un DOCX complesso.
>
> **Percorso consigliato:**
>
> 1. ricavare dal DOCX una versione solo testuale, per esempio in formato TXT, e usarla in Anonimator per individuare e revisionare le entità;
> 2. esportare dall’app il dizionario delle entità in formato JSON;
> 3. caricare nuovamente il file DOCX originale e importare il JSON prima di creare il nuovo documento Word.
>
> È un passaggio in più e può risultare scomodo, ma evita molti problemi legati alla struttura interna dei file Word. Non elimina comunque la necessità di confrontare integralmente il DOCX prodotto con l’originale.

## PDF scansionati, OCR e sicurezza dell’output

OCR significa “riconoscimento ottico dei caratteri”: trasforma una scansione in parole e posizioni utilizzabili dall’app. Anonimator valuta la qualità e l’allineamento del testo già presente nel PDF; se necessario può proporre di rifare l’OCR interno. Una scansione poco nitida, inclinata o a bassa risoluzione resta comunque difficile da interpretare e richiede maggiore controllo umano.

Per le scansioni, l’app non si limita a mettere un rettangolo sopra il dato: ricostruisce le pagine per non conservare nel PDF i pixel originari sottostanti. Un output completo può inoltre ricevere un nuovo livello di testo ricercabile composto da testo non sensibile e pseudonimi, non dalle entità originali confermate.

Prima del salvataggio vengono ricontrollati file, pagine e occorrenze. Se il risultato non può essere considerato completo, il nome contiene **`_DA_VERIFICARE`** e il PDF resta privo di livello testuale ricercabile. Questo suffisso è un avviso importante, non una certificazione che le parti riuscite siano esenti da errori.

### Aspetto a colori o bianco e nero

Per PDF scansionati e immagini si può scegliere:

- **Aspetto a colori (consigliato):** mantiene colori e tonalità visibili, con ricompressione JPEG; il risultato non è una copia identica pixel per pixel.
- **Bianco e nero compatto:** converte irreversibilmente le pagine scansionate a un solo bit. Può ridurre le dimensioni, ma può anche eliminare informazioni presenti in timbri, firme chiare, evidenziature, fotografie o testo sbiadito. L’app richiede una conferma esplicita.

Le pagine PDF nate digitalmente non vengono convertite in bitonale. In entrambe le modalità il documento originale rimane invariato.

## Privacy: che cosa resta locale

- Testo, OCR, riconoscimento delle entità e generazione del file avvengono localmente.
- La trascrizione OCR usata durante il lavoro resta in memoria ed è collegata alla singola analisi; viene liberata quando l’analisi è chiusa o la sessione viene azzerata.
- I log applicativi non devono contenere testo del documento, nomi, pseudonimi, token di analisi o percorsi dei file.
- **Copia diagnostica** raccoglie solo versione, piattaforma e stato dei componenti, senza testo degli atti o percorsi locali.
- L’eventuale LLM deve essere un servizio locale configurato dall’utente. Anonimator non richiede un servizio LLM cloud.

Servono invece Internet e contatto con servizi esterni quando l’utente scarica i modelli NER/OCR. Inoltre il sistema operativo e altri programmi possono leggere o sincronizzare appunti, file recenti, backup o cartelle cloud: la loro configurazione non è controllata da Anonimator.

## Installazione della versione 1.8.0

Scaricare l’asset corretto dalla pagina [Anonimator v1.8.0](https://github.com/avvocati-e-mac/anonimator/releases/tag/v1.8.0):

| Sistema | File esatto |
|---|---|
| Mac Apple Silicon (M1, M2, M3, M4) | `Anonimator-1.8.0-arm64.dmg` |
| Mac Intel | `Anonimator-1.8.0-x64.dmg` |
| Windows 10/11 a 64 bit | `Anonimator-1.8.0-windows-x64-setup.exe` |
| Linux x86_64 | `Anonimator-1.8.0-linux-x86_64.AppImage` |

Al primo utilizzo l’app deve scaricare il modello NER e i dati italiani per l’OCR, circa 80 MB complessivi. Dopo il download, l’elaborazione ordinaria può avvenire senza collegamento Internet.

### macOS

Aprire il DMG e trascinare `Anonimator.app` in **Applicazioni**. La versione 1.8.0 non è firmata né notarizzata; se macOS la blocca, eseguire una sola volta nel Terminale:

```bash
sudo xattr -cr /Applications/Anonimator.app
```

Il comando presuppone che l’app sia stata copiata in `/Applications`.

### Windows

Avviare `Anonimator-1.8.0-windows-x64-setup.exe`. Poiché l’installer non è firmato con un certificato Microsoft, SmartScreen può mostrare un avviso: selezionare **Ulteriori informazioni**, quindi **Esegui comunque**, soltanto dopo aver verificato di avere scaricato il file dalla release ufficiale.

### Linux

Rendere eseguibile l’AppImage e avviarla:

```bash
chmod +x Anonimator-1.8.0-linux-x86_64.AppImage
./Anonimator-1.8.0-linux-x86_64.AppImage
```

Su alcune distribuzioni può essere necessario installare `libfuse2`.

## Uso essenziale

1. Aprire Anonimator e completare, se richiesto, il download dei modelli.
2. Trascinare il documento o selezionarlo dal computer.
3. Attendere analisi del testo, OCR quando necessario e riconoscimento delle entità.
4. Controllare tutte le proposte: testo originale, tipo, numero di occorrenze e pseudonimo.
5. Aggiungere gli elementi mancanti; per PDF e immagini OCR, nella 1.9.0 usare quando disponibile la ricerca verificata.
6. Per scansioni e immagini scegliere l’aspetto del PDF; usare il bitonale solo dopo averne valutato la possibile perdita visiva.
7. Creare il file, aprirlo e confrontarlo integralmente con l’originale. Controllare anche ricerca, copia del testo, immagini, intestazioni, piè di pagina, allegati e metadati pertinenti al proprio flusso.

Per una spiegazione tecnica e operativa più estesa vedere [GUIDA.md](GUIDA.md). Le modifiche versione per versione sono in [CHANGELOG.md](CHANGELOG.md).

## Limiti da conoscere

- Nessun sistema NER, OCR o LLM garantisce di individuare ogni dato personale.
- La stessa persona può comparire con abbreviazioni, errori, soprannomi o immagini non leggibili.
- Un riquadro visibile nell’anteprima non dimostra da solo che ogni altra occorrenza sia stata trattata.
- La conversione bitonale può perdere contenuto utile; la modalità a colori può produrre file più grandi dell’originale.
- Il livello ricercabile di una scansione è ricostruito dall’OCR e può contenere errori di trascrizione.
- Dizionari JSON e sessioni salvate conservano la corrispondenza fra originali e pseudonimi e vanno protetti.
- Anonimator non decide quali dati sia giuridicamente necessario rimuovere e non sostituisce la valutazione professionale del caso concreto.

## Sviluppo assistito da IA agentica

Anonimator è stato sviluppato anche con l’uso di **IA agentica**, cioè sistemi di intelligenza artificiale impiegati per analizzare il codice, proporre modifiche, scrivere test e preparare documentazione. Questa informazione è dichiarata per trasparenza: l’uso dell’IA non costituisce una garanzia di qualità, sicurezza o correttezza.

Le decisioni di architettura, la revisione delle modifiche, la definizione delle verifiche, l’esecuzione dei test e la pubblicazione delle release restano sottoposte a supervisione umana. Anche con questi controlli possono esistere difetti; chi usa l’app deve mantenere la revisione professionale descritta sopra.

## Per sviluppatori

### Requisiti

- Node.js 20 o successivo e npm 10 o successivo;
- macOS 12+, Windows 10/11 oppure Linux x64;
- dipendenze di sistema indicate dai test PDF/OCR per eseguire i gate completi.

### Avvio da sorgente

```bash
git clone https://github.com/avvocati-e-mac/anonimator.git
cd anonimator
npm install
bash scripts/download-models.sh
npm start
```

### Controlli principali

```bash
npm run typecheck:all
npm run ui:build
npm run test:unit
npm run test:ner-recall
npm run test:corpus
npm run test:roundtrip
npm run test:pixel-leak
npm run test:searchable-pdf
npm run test:pdf-rss
```

I test di richiamo NER/OCR usano un corpus interamente sintetico di atti e moduli. Misurano dati trovati, omissioni e falsi positivi senza inserire documenti reali nel repository. Rendono le regressioni riproducibili, ma non garantiscono risultati completi su qualsiasi atto.

L’app usa Electron, React e TypeScript. Il processo principale gestisce file, OCR, riconoscimento e generazione; l’interfaccia non ha accesso diretto a Node.js o al filesystem. Le richieste sensibili sono validate e legate all’analisi e alla finestra che le ha create.

## Licenza

MIT — vedere [LICENSE](LICENSE).
