# Anonimator

App desktop per la **pseudoanonimizzazione offline** di documenti legali italiani.

Pensata per avvocati e professionisti legali: nessun dato viene mai inviato a server esterni. Tutto il processing avviene localmente sul tuo Mac.

**L’app Electron è stata creata in vibe coding e non sono un esperto programmatore quindi procedi con cautela nell’utilizzo.**

## Funzionalita'

- Riconosce automaticamente nomi di persone, luoghi, organizzazioni, codici fiscali, P.IVA, IBAN, email e numeri di telefono
- Sostituisce le entita' con pseudonimi coerenti in tutto il documento (es. "Mario Rossi" → "M. R." ovunque appaia)
- Supporta PDF (nativi e scansionati via OCR), DOCX, ODT e TXT
- Elaborazione batch di piu' file contemporaneamente
- 100% offline — nessuna connessione di rete durante l'elaborazione (GDPR compliant)

## Installazione rapida (DMG)

Scarica il DMG dalla pagina [Releases](https://github.com/avvocati-e-mac/anonimator/releases):
- `Anonimator-x.x.x-arm64.dmg` → Mac Apple Silicon (M1/M2/M3/M4)
- `Anonimator-x.x.x-x64.dmg` → Mac Intel

Trascina `Anonimator.app` nella cartella Applicazioni.

### L'app non è firmata né notarizzata — passaggi obbligatori

Poiché l'app non è distribuita tramite il Mac App Store né firmata con un certificato Apple Developer, macOS la blocca all'apertura. Esegui questi due comandi nel Terminale **una sola volta** dopo l'installazione:

**1. Disabilita il blocco Gatekeeper:**
```bash
spctl --master-disable
```
Poi apri **Impostazioni di Sistema → Privacy e Sicurezza** e dal menu a tendina seleziona **Dovunque**.

**2. Rimuovi l'app dalla quarantena:**
```bash
sudo xattr -cr /Applications/Anonimator.app
```
> Il comando presume che l'app sia nella cartella Applicazioni. Se l'hai installata altrove, sostituisci il percorso di conseguenza.

Dopo questi passaggi l'app si apre normalmente.

---

## Requisiti

- macOS 12+ (arm64 / Apple Silicon o x64 / Intel)
- Node.js 20+ e npm 10+
- Circa 200 MB di spazio per il modello NER e i dati OCR

## Installazione

```bash
# 1. Clona il repository
git clone https://github.com/avvocati-e-mac/anonimator.git
cd anonimator

# 2. Installa le dipendenze Node.js
npm install

# 3. Scarica il modello NER e il file tessdata per OCR
bash scripts/download-models.sh

# 4. Avvia l'app in modalita' sviluppo
npm start
```

## Comandi disponibili

| Comando | Descrizione |
|---|---|
| `npm start` | Avvia l'app in modalita' sviluppo |
| `npm test` | Esegue i test unitari (vitest) |
| `npm run typecheck` | Verifica TypeScript senza compilare |
| `npm run dist:mac:arm64` | Crea il DMG per macOS Apple Silicon |
| `npm run dist:mac:x64` | Crea il DMG per macOS Intel |
| `npm run dist:mac:both` | Crea entrambi i DMG (arm64 + x64) in sequenza |

## Architettura

- **Electron** (Main process): parsing documenti, NER engine, generazione output
- **React 18 + TypeScript**: interfaccia utente (sandboxed renderer)
- **Transformers.js + ONNX**: modello NER italiano locale (`Laibniz/italian-ner-pii-browser-distilbert`)
- **MuPDF + pdf-lib**: redaction e ricostruzione PDF
- **Tesseract.js**: OCR offline per PDF scansionati

I modelli AI sono bundled nell'app — nessun download avviene all'avvio.

## Struttura del progetto

```
src/
  main/         # Processo Node.js (parser, NER, output generators)
  preload/      # contextBridge (API renderer → main)
  renderer/     # App React (sandboxed, zero Node.js access)
  shared/       # Tipi TypeScript condivisi (IPC contracts)
resources/
  models/       # Modello ONNX NER (scaricato da download-models.sh)
  tessdata/     # Dati OCR italiano (scaricato da download-models.sh)
scripts/
  download-models.sh  # Script di setup modelli
tests/          # Test unitari
```

## Licenza

MIT — vedi [LICENSE](LICENSE)
