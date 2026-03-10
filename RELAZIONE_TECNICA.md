# Report Analisi Tecnica: Anonimator (v1.2.3)

Questo documento riassume le scoperte effettuate durante il monitoraggio dell'applicazione, evidenziando comportamenti non conformi e proponendo soluzioni tecniche.

---

## 1. Scoperte e Comportamenti Aberranti

### 1.1 Diagnostica NER e Migrazione (RISOLTO)
**Stato:** Risolto in v1.2.6.
**Soluzione:** Implementata migrazione automatica che sposta `model_quantized.onnx` da `onnx/` alla root della cartella modello. Il controllo diagnostico ora punta al percorso corretto nella root.

### 1.2 Fallimento Silenzioso del Servizio LLM
**Comportamento:** L'app tenta di contattare un server LLM locale (`openai/gpt-oss-20b`) ricevendo un errore `500 Internal Server Error`.
**Causa:** Dipendenza esterna non raggiungibile o mal configurata nel backend locale (es. Ollama o LM Studio).
**Nota Positiva:** Il sistema gestisce l'errore con un fallback pulito sulle sole regex e BERT, garantendo la continuità del servizio ("continuo senza").

### 1.3 Localizzazione Modelli in Sviluppo vs Produzione
**Comportamento:** L'utente si aspettava il caricamento da `userData`, ma l'app attingeva dalla cartella `resources` del progetto.
**Analisi:** La funzione `getModelPath()` implementa correttamente la gerarchia: `userData` -> `dev`. In modalità sviluppo (`npm start`), il fallback finale su `devPath` è il comportamento atteso.

### 1.4 Incoerenza Stilistica nel Codice (nerService.ts)
**Osservazione:** All'interno di una funzione `async` (riga 323), vengono usate `require('fs')` e `require('path')` nonostante i moduli siano già stati importati staticamente all'inizio del file (`import { join } from 'path'; import { existsSync } from 'fs';`). Questo indica un debito tecnico o un copia-incolla non rifinito.

---

## 2. Analisi dei Rischi e Altri Problemi Potenziali

- **Timeout LLM:** In `llmService.ts`, il timeout è gestito tramite `AbortController`. Se il modello locale è molto grande o il sistema è sotto carico, il timeout potrebbe scattare prematuramente, causando una perdita di precisione nell'anonimizzazione senza che l'utente ne sia pienamente consapevole.
- **Warning PDF (TT: undefined function: 32):** Messaggi di allerta durante il parsing PDF che suggeriscono una compatibilità parziale di alcuni font/funzioni, potenzialmente impattando sulla qualità dell'estrazione testo.

---

## 3. Soluzioni e Implementazioni Proposte

### A. Correzione Diagnostica (Alta Priorità)
Sostituire il controllo manuale con la costante corretta:
```typescript
// Da:
const modelExists = require('fs').existsSync(require('path').join(modelPath, 'model_quantized.onnx'))
// A:
const modelExists = existsSync(join(modelPath, NER_CHECK_FILE))
```

### B. Miglioramento Feedback UI per LLM
In caso di errore LLM (es. 500), mostrare un avviso non bloccante nella UI per informare l'utente che l'anonimizzazione sta procedendo con precisione ridotta (solo BERT + Regex).

### C. Switch "Test Mode" per i Modelli
Introdurre una flag (`PROCESS_ENV.TEST_USERDATA_MODELS`) per forzare l'uso di `userData` anche in sviluppo, permettendo di testare il flusso di download.

### D. Refactoring Import Dinamici
Pulire `nerService.ts` eliminando i `require` ridondanti e standardizzando l'uso degli import statici.

---

**Stato attuale dell'app:** Funzionante e stabile.
