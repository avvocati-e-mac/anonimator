<p align="center">
  <img src="build-resources/anonimator.png" alt="Icona ufficiale di Anonimator: un robot arancione con maschera" width="180">
</p>

<h1 align="center">Anonimator</h1>

<p align="center"><strong>Pseudoanonimizzazione locale di documenti legali, con revisione del professionista.</strong></p>

> [!NOTE]
> **Sviluppo assistito da IA agentica**
>
> Anonimator è stato sviluppato anche con l’assistenza di agenti di intelligenza artificiale, impiegati nell’analisi del codice, nella proposta di modifiche, nella scrittura dei test e nella preparazione della documentazione. Il loro lavoro è stato sottoposto a supervisione umana: le scelte di architettura, la revisione delle modifiche, le verifiche e la pubblicazione delle release restano responsabilità umane. Dichiararlo è una scelta di trasparenza, non una garanzia di qualità, sicurezza o correttezza.

## A che cosa serve

Come proteggere nomi e altri dati presenti in un atto senza affidare il documento a un servizio cloud?

La risposta breve è **Anonimator**: un’app desktop che lavora sul computer, propone le informazioni potenzialmente identificative e crea una nuova copia del documento con pseudonimi coerenti. L’originale non viene modificato.

L’analisi ordinaria avviene in locale. Internet serve per scaricare i modelli al primo utilizzo. È possibile affiancare un modello linguistico locale, come Ollama o LM Studio, ma non è obbligatorio.

**Versione pubblicata: 1.8.0.** Nel codice è in preparazione la 1.9.0, che introduce la ricerca verificata nel documento descritta più avanti.

> [!IMPORTANT]
> **Il controllo finale spetta sempre al professionista.**
>
> Anonimator è uno strumento di supporto, non un controllo automatico definitivo. Può omettere dati o proporre elementi non sensibili. Prima di comunicare, produrre o depositare il file occorre verificare sia l’elenco delle entità sia il risultato, pagina per pagina.

## Indice

- [A che cosa serve](#a-che-cosa-serve)
- [Come lavora, in cinque passaggi](#come-lavora-in-cinque-passaggi)
- [Che cosa può riconoscere](#che-cosa-può-riconoscere)
- [Revisione e pseudonimi](#revisione-e-pseudonimi)
  - [Ricerca verificata nel documento (sviluppo 1.9.0)](#ricerca-verificata-nel-documento-sviluppo-190)
- [Formati supportati](#formati-supportati)
  - [Nota importante per i file DOCX](#nota-importante-per-i-file-docx)
- [PDF scansionati, OCR e sicurezza dell’output](#pdf-scansionati-ocr-e-sicurezza-delloutput)
  - [Aspetto a colori o bianco e nero](#aspetto-a-colori-o-bianco-e-nero)
- [Privacy: che cosa resta locale](#privacy-che-cosa-resta-locale)
- [Installazione della versione 1.8.0](#installazione-della-versione-180)
- [Uso essenziale](#uso-essenziale)
- [Limiti da conoscere](#limiti-da-conoscere)
- [Per sviluppatori](#per-sviluppatori)
- [Licenza](#licenza)

## Come lavora, in cinque passaggi

| Passaggio | Che cosa succede |
|---:|---|
| **1. Carica** | Trascini uno o più documenti nell’app. |
| **2. Analizza** | Anonimator estrae o riconosce il testo e propone i dati da proteggere. |
| **3. Rivedi** | Decidi che cosa trattare, correggi gli errori e controlli gli pseudonimi. |
| **4. Crea** | L’app genera una nuova copia senza modificare l’originale. |
| **5. Verifica** | Apri il risultato e lo confronti integralmente con il documento di partenza. |

> [!WARNING]
> **Pseudoanonimizzare non significa anonimizzare in modo definitivo.** Chi dispone del dizionario di corrispondenza, o di altre informazioni, può risalire dalla persona fittizia a quella originaria. Il JSON esportato e la sessione salvata sono quindi materiale riservato.

## Che cosa può riconoscere

Anonimator combina regole pensate per i documenti italiani, un modello NER locale — il componente che riconosce nomi ed entità nel testo — e, se configurato, un modello linguistico locale.

| Area | Esempi |
|---|---|
| **Persone** | Nomi, cognomi, soprannomi e riferimenti successivi alla stessa persona |
| **Luoghi e dati anagrafici** | Indirizzi, residenza, luogo e data di nascita |
| **Codici e recapiti** | Codice fiscale, partita IVA, IBAN, email e telefono |
| **Altri identificativi** | Targhe e numeri di documento |
| **Soggetti collettivi** | Organizzazioni, aziende e datori di lavoro |

Nei moduli riconosce anche campi accompagnati da etichette come “Cognome”, “Nome” o “Dipendente”. Dalla 1.8.0 tollera alcune comuni confusioni OCR fra lettere e numeri e usa il contesto per ridurre falsi riconoscimenti di targhe e partite IVA.

Le organizzazioni individuate automaticamente sono normalmente **deselezionate**. È l’utente a decidere se proteggerle; lo stesso controllo resta necessario per tutte le altre proposte.

## Revisione e pseudonimi

La schermata di revisione è il centro del lavoro. Qui puoi includere o escludere un’entità, correggere il testo da cercare, cambiarne il tipo e modificare lo pseudonimo proposto. Puoi anche aggiungere un dato sfuggito al riconoscimento.

| Esigenza | Funzione disponibile |
|---|---|
| **Mantenere gli stessi nomi fittizi** | Le occorrenze della stessa persona vengono ricondotte, quando possibile, allo stesso pseudonimo. |
| **Lavorare su una pratica con più file** | L’app riunisce le entità in un solo elenco, così la scelta si compie una volta per tutto il gruppo. |
| **Riutilizzare il lavoro** | Puoi esportare o importare un dizionario JSON e salvare la sessione. |
| **Capire che cosa sta accadendo** | L’avanzamento distingue lettura, OCR, analisi e creazione dell’output; il riepilogo finale mostra file, pagine, durata e velocità. |
| **Controllare l’installazione** | Dalle Impostazioni puoi verificare o scaricare i modelli mancanti e copiare una diagnostica essenziale. |

Una schermata iniziale presenta i tre livelli di riconoscimento e spiega i requisiti dell’eventuale LLM locale. Il tema chiaro o scuro viene ricordato. Durante la creazione di una scansione, l’app segnala inoltre che sta riutilizzando l’OCR già in memoria e non sta riconoscendo il testo una seconda volta.

### Ricerca verificata nel documento (sviluppo 1.9.0)

Per PDF e immagini con trascrizione OCR, il pulsante **Aggiungi** apre un percorso più controllabile.

| Fase | Controllo offerto |
|---:|---|
| **1. Seleziona** | Consultando la trascrizione pagina per pagina, selezioni una o più parole e scegli **Usa selezione**. |
| **2. Cerca** | L’app trova le corrispondenze esatte nell’intero documento e ne mostra il numero. |
| **3. Confronta** | Puoi scorrere le occorrenze e, su richiesta, vedere la pagina completa con l’area evidenziata. |
| **4. Conferma** | Solo dopo il controllo aggiungi l’entità alla revisione. |

La selezione si aggancia alle **parole OCR intere**. Se cambi a mano il testo, la selezione precedente viene invalidata e il valore diventa un nuovo testo digitato. Un nome più completo può essere proposto soltanto come suggerimento adiacente e non viene mai scelto automaticamente: cercando “Carlo” l’app può suggerire “Carlo Alberto Ruggeri”; cercando “Carlo Ruggeri” non salta la parola “Alberto”.

> [!NOTE]
> Questa funzione richiede parole e posizioni prodotte dall’OCR. Per DOCX, ODT, TXT e Markdown resta disponibile l’aggiunta manuale ordinaria. Errori OCR, parole fuse o grafie diverse possono impedire una corrispondenza esatta.

L’anteprima grafica carica una sola pagina per volta come JPEG ridimensionato: aiuta a orientarsi, ma non sostituisce il controllo del file finale. Se l’immagine non può essere generata, trascrizione e verifica testuale restano disponibili. Il copia e incolla usa invece gli appunti del sistema operativo, esterni al perimetro di protezione dell’app.

## Formati supportati

| Documento in ingresso | Risultato |
|---|---|
| PDF digitale | Nuovo PDF pseudoanonimizzato |
| PDF scansionato o misto | Nuovo PDF ricostruito pagina per pagina |
| Immagine PNG, JPG o JPEG | Nuovo PDF ricostruito dall’immagine |
| DOCX | Nuovo DOCX |
| ODT | Nuovo ODT |
| TXT | Nuovo TXT |
| Markdown (`.md`) | Nuovo file Markdown |

Puoi elaborare più file insieme e revisionare le entità in un’unica schermata. La resa dei formati modificabili, soprattutto DOCX e ODT complessi, deve sempre essere confrontata con l’originale.

### Nota importante per i file DOCX

> [!WARNING]
> **Microsoft Word può nascondere una struttura molto più complessa di quella visibile.**
>
> Una parola o una frase che sullo schermo appare continua può essere suddivisa internamente in più frammenti. Formattazione, revisioni e altri elementi di Word possono quindi rendere meno affidabili l’individuazione e la sostituzione diretta delle entità in un DOCX complesso.
>
> **Il percorso consigliato è questo:**
>
> 1. ricava dal DOCX una versione di solo testo, per esempio in formato TXT, e usala in Anonimator per individuare e revisionare le entità;
> 2. esporta dall’app il dizionario delle entità in formato JSON;
> 3. carica nuovamente il DOCX originale e importa quel JSON prima di creare il nuovo documento Word.
>
> È un passaggio in più e può risultare scomodo, ma risolve molti problemi dovuti alla struttura interna dei file Word. Al termine, confronta comunque tutto il DOCX prodotto con l’originale.

## PDF scansionati, OCR e sicurezza dell’output

OCR significa “riconoscimento ottico dei caratteri”: trasforma una scansione in parole e posizioni che l’app può usare. Anonimator valuta qualità e allineamento del testo già presente nel PDF e, se necessario, può proporre di rifare l’OCR interno.

Una scansione poco nitida, inclinata o a bassa risoluzione resta difficile da interpretare. Qui la tecnologia non può sostituire un controllo più attento.

### Che cosa accade alle scansioni

Anonimator non si limita a coprire il dato con un rettangolo. Ricostruisce le pagine per non conservare nel PDF i pixel originari sottostanti. Se l’elaborazione è completa, può aggiungere un nuovo livello ricercabile formato dal testo non sensibile e dagli pseudonimi, non dalle entità originali confermate.

Prima del salvataggio ricontrolla file, pagine e occorrenze.

> [!CAUTION]
> Se il risultato non può essere considerato completo, il nome del file contiene **`_DA_VERIFICARE`** e il PDF resta privo di testo ricercabile. Il suffisso è un avviso importante: non certifica che le parti elaborate siano prive di errori.

### Aspetto a colori o bianco e nero

| Scelta | Che cosa comporta |
|---|---|
| **Aspetto a colori — consigliato** | Mantiene colori e tonalità visibili, con ricompressione JPEG. Il risultato non è una copia identica pixel per pixel. |
| **Bianco e nero compatto** | Converte irreversibilmente le pagine scansionate a un solo bit. Può ridurre le dimensioni, ma perdere dettagli di timbri, firme chiare, evidenziature, fotografie o testo sbiadito. Richiede una conferma esplicita. |

Le pagine PDF nate digitalmente non vengono convertite in bitonale. In entrambe le modalità l’originale rimane invariato.

## Privacy: che cosa resta locale

Il punto di partenza è semplice: durante il lavoro ordinario, documento e analisi restano sul computer.

| Ambito | Comportamento |
|---|---|
| **Elaborazione** | Testo, OCR, riconoscimento delle entità e generazione del file avvengono localmente. |
| **Memoria** | La trascrizione OCR è legata alla singola analisi e viene liberata quando la chiudi o azzeri la sessione. |
| **Log e diagnostica** | I log non devono contenere testo dell’atto, nomi, pseudonimi, token o percorsi. **Copia diagnostica** raccoglie soltanto versione, piattaforma e stato dei componenti. |
| **LLM facoltativo** | Deve essere un servizio locale configurato dall’utente; Anonimator non richiede un LLM cloud. |
| **Internet** | Serve per scaricare i modelli NER e OCR. |

> [!NOTE]
> Il sistema operativo e altri programmi possono leggere o sincronizzare appunti, file recenti, backup e cartelle cloud. Questi elementi sono esterni ad Anonimator e dipendono dalla configurazione del computer.

## Installazione della versione 1.8.0

Scarica il file adatto al tuo computer dalla pagina [Anonimator v1.8.0](https://github.com/avvocati-e-mac/anonimator/releases/tag/v1.8.0).

| Sistema | File esatto |
|---|---|
| Mac Apple Silicon (M1, M2, M3, M4) | `Anonimator-1.8.0-arm64.dmg` |
| Mac Intel | `Anonimator-1.8.0-x64.dmg` |
| Windows 10/11 a 64 bit | `Anonimator-1.8.0-windows-x64-setup.exe` |
| Linux x86_64 | `Anonimator-1.8.0-linux-x86_64.AppImage` |

Al primo avvio l’app deve scaricare il modello NER e i dati italiani per l’OCR, circa 80 MB complessivi. Completato il download, l’elaborazione ordinaria può avvenire senza collegamento Internet.

<details>
<summary><strong>Installazione su macOS</strong></summary>

Apri il DMG e trascina `Anonimator.app` in **Applicazioni**. La versione 1.8.0 non è firmata né notarizzata; se macOS la blocca, esegui una sola volta nel Terminale:

```bash
sudo xattr -cr /Applications/Anonimator.app
```

Il comando presuppone che l’app sia stata copiata in `/Applications`.

</details>

<details>
<summary><strong>Installazione su Windows</strong></summary>

Avvia `Anonimator-1.8.0-windows-x64-setup.exe`. Poiché l’installer non è firmato con un certificato Microsoft, SmartScreen può mostrare un avviso. Seleziona **Ulteriori informazioni**, quindi **Esegui comunque**, soltanto dopo aver verificato che il file provenga dalla release ufficiale.

</details>

<details>
<summary><strong>Installazione su Linux</strong></summary>

Rendi eseguibile l’AppImage e avviala:

```bash
chmod +x Anonimator-1.8.0-linux-x86_64.AppImage
./Anonimator-1.8.0-linux-x86_64.AppImage
```

Su alcune distribuzioni può essere necessario installare `libfuse2`.

</details>

## Uso essenziale

1. Apri Anonimator e completa, se richiesto, il download dei modelli.
2. Trascina il documento o selezionalo dal computer.
3. Attendi l’analisi del testo, l’eventuale OCR e il riconoscimento delle entità.
4. Controlla tutte le proposte: testo originale, tipo, numero di occorrenze e pseudonimo.
5. Aggiungi gli elementi mancanti; per PDF e immagini OCR, nella 1.9.0 usa quando disponibile la ricerca verificata.
6. Per scansioni e immagini scegli l’aspetto del PDF. Usa il bitonale solo dopo aver valutato la possibile perdita visiva.
7. Crea il file, aprilo e confrontalo integralmente con l’originale. Controlla anche ricerca e copia del testo, immagini, intestazioni, piè di pagina, allegati e metadati pertinenti al tuo flusso.

La spiegazione tecnica e operativa completa è in [GUIDA.md](GUIDA.md); la cronologia delle modifiche è in [CHANGELOG.md](CHANGELOG.md).

## Limiti da conoscere

| Punto da controllare | Perché conta |
|---|---|
| **Riconoscimento** | Nessun sistema NER, OCR o LLM trova con certezza ogni dato personale. Abbreviazioni, errori, soprannomi e immagini poco leggibili possono nascondere un’identità. |
| **Anteprima** | Un riquadro visibile non dimostra che tutte le altre occorrenze siano state trattate. |
| **Resa visiva** | Il bitonale può perdere contenuto utile; la modalità a colori può generare file più grandi dell’originale. |
| **Testo ricercabile** | Nelle scansioni viene ricostruito dall’OCR e può contenere errori di trascrizione. |
| **Dizionari e sessioni** | Conservano il collegamento fra originali e pseudonimi e devono essere protetti. |
| **Valutazione giuridica** | Anonimator non decide quali dati sia necessario rimuovere e non sostituisce la valutazione professionale del caso concreto. |

## Per sviluppatori

### Requisiti

| Componente | Requisito |
|---|---|
| Runtime | Node.js 20 o successivo; npm 10 o successivo |
| Sistema | macOS 12+, Windows 10/11 oppure Linux x64 |
| Gate completi | Dipendenze di sistema richieste dai test PDF/OCR |

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

L’app usa Electron, React e TypeScript. Il processo principale gestisce file, OCR, riconoscimento e generazione; l’interfaccia non accede direttamente a Node.js o al filesystem. Le richieste sensibili sono validate e legate all’analisi e alla finestra che le ha create.

## Licenza

Licenza MIT.
