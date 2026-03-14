# Sessione 033 — Diagnostica installazione + pulsante "Copia diagnostica"

**Data:** 2026-03-08
**Versione:** 1.1.9 → 1.2.0
**Fase:** Feature osservabilità/diagnostica

---

## Obiettivo

Due strumenti per supportare utenti con problemi (es. NER non funzionante):
1. Script bash standalone per verificare l'installazione su macchine remote
2. Pulsante nell'app per raccogliere e copiare diagnostica negli appunti

---

## Modifiche effettuate

### 1. `src/shared/types.ts`
Aggiunto canale `DIAG_COLLECT: 'diag:collect'` a `IPC_CHANNELS`.

### 2. `src/main/services/nerService.ts`
Esportata `getModelPath()` (aggiunto `export`).

### 3. `src/main/ipcHandlers.ts`
- Import aggiornato: `clipboard` da `electron`, `existsSync` da `fs`, `getModelPath` da `nerService`
- Aggiunto handler `DIAG_COLLECT`:
  - Verifica `model_quantized.onnx`, `onnxruntime_binding.node`, `detect-libc`
  - Legge ultime 100 righe di `main.log`
  - Compone testo diagnostica e lo copia negli appunti con `clipboard.writeText()`
  - Restituisce la stringa al renderer (per eventuale uso futuro)

### 4. `src/preload/index.ts`
Esposta funzione `collectDiagnostics()` → `ipcRenderer.invoke('diag:collect')`.

### 5. `src/renderer/src/env.d.ts`
Aggiunto `collectDiagnostics: () => Promise<string>` a `ElectronAPI`.

### 6. `src/renderer/src/components/SettingsScreen.tsx`
- Import aggiunto: `ClipboardCopy` da lucide-react
- Stato aggiunto: `diagState: 'idle' | 'loading' | 'copied'`
- Funzione `handleCollectDiag()`: chiama `collectDiagnostics()`, mostra feedback "Copiato!" per 3s
- Nuova sezione UI "Diagnostica" sotto la sezione LLM: pulsante con stati idle/loading/copied

### 7. `scripts/check-install.sh` (NUOVO)
Script bash standalone, eseguibile su qualsiasi Mac con Anonimator installato.
Verifica:
- Path app (default `/Applications/Anonimator.app` o custom)
- Versione da `Info.plist`
- `model_quantized.onnx` e `tokenizer.json`
- `onnxruntime_binding.node` per l'architettura corrente
- Suggerisce se il binding dell'architettura opposta è presente (errore di build)
- `detect-libc` in `app.asar.unpacked`
- Binari `@img/sharp-darwin-*`
- `ita.traineddata` (OCR)
- Ultime 30 righe di `~/Library/Logs/Anonimator/main.log`
- Riepilogo finale ✅/❌ con conteggio problemi

Output colorato (verde/rosso). Istruzione finale: seleziona tutto, copia, invia.

Uso remoto:
```bash
bash <(curl -s https://raw.githubusercontent.com/avvocati-e-mac/anonimator/master/scripts/check-install.sh)
```

### 8. `package.json` — bump versione `1.1.9` → `1.2.0`

### 9. `CHANGELOG.md` — aggiunta sezione `[1.2.0]`

---

## Verifica

- `npm run typecheck` → PASS (zero errori)

---

## Commit

- `c1ee543` — feat(diag): diagnostica installazione + script check-install.sh — v1.2.0
- `2f2530b` — docs(readme): aggiunge comando verifica installazione macOS con check-install.sh
- Tag `v1.2.0` pushato → CI in corso

## Prossimi step

- Verificare CI completata su GitHub Actions
- Testare in dev: aprire Impostazioni → sezione Diagnostica → "Copia diagnostica" → verificare testo incollato
- Condividere script `check-install.sh` e comando curl con utenti che segnalano problemi
