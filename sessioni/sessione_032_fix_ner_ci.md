# Sessione 032 — Fix NER macOS ARM64 + Diagnostica CI

**Data:** 2026-03-08
**Versione:** 1.1.6 → 1.1.7
**Fase:** Bug fix + CI miglioramento

---

## Problema segnalato

NER (riconoscimento entità BERT) non funzionava nella build macOS ARM64.
Causa: `@huggingface/transformers` importa `sharp` a import-time. Il binario
`@img/sharp-darwin-arm64/sharp.node` veniva richiesto da dentro `app.asar`,
ma dlopen() non funziona su file dentro asar → `tryLoadTransformers()` lanciava
eccezione → NER BERT disabilitato silenziosamente.

---

## Modifiche effettuate

### 1. `src/main/index.ts` — estesa patch `Module._resolveFilename`

**Prima:**
```typescript
if (resolved.endsWith('.node') || resolved.includes('onnxruntime')) {
```

**Dopo:**
```typescript
if (resolved.endsWith('.node') || resolved.includes('onnxruntime') || resolved.includes('/sharp') || resolved.includes('@img')) {
```

Copre anche i path di `sharp` e `@img/sharp-darwin-*`, garantendo che i
binari arch-specifici vengano sempre risolti da `app.asar.unpacked`.

### 2. `src/main/services/nerService.ts` — log diagnostico startup

Aggiunto in `getNerPipeline()` (subito dopo le early-return guard):
```typescript
const modelPath = getModelPath()
const modelExists = require('fs').existsSync(require('path').join(modelPath, 'model_quantized.onnx'))
log.info('NER diagnostics', {
  modelPath, modelExists, resourcesPath: process.resourcesPath,
  platform: process.platform, arch: process.arch
})
```

Per leggere il log: `~/Library/Logs/Anonimator/main.log` → cerca `NER diagnostics`.

### 3. `.github/workflows/release.yml` — rebuild + smoke test

- **`build-mac-arm64`:** aggiunto `npx @electron/rebuild --force` + smoke test
- **`build-mac-x64`:** aggiunto `npx @electron/rebuild --force` (PRIMA dell'install sharp x64) + smoke test
- **`build-linux`:** aggiunto `npx @electron/rebuild --force` + smoke test
- **`build-windows`:** aggiunto smoke test (rebuild era già presente)

Smoke test verifica:
- `model_quantized.onnx` presente nel pacchetto
- `onnxruntime_binding.node` presente nel pacchetto

Fallisce il job prima dell'upload se uno dei due manca.

### 4. `package.json` — bump versione

`1.1.6` → `1.1.7`

### 5. `CHANGELOG.md` — aggiunta sezione `[1.1.7]`

---

## Verifica

- `npm run typecheck` → PASS (zero errori)
- Build locale non eseguita in questa sessione (non necessaria per verificare le modifiche)

---

## Prossimi step

- Fare la build (tag v1.1.7 su GitHub) per testare CI con smoke test
- Verificare con l'utente se NER funziona su ARM64 dopo il fix
- Appena confermato: chiudere bug `[APERTO] NER non carica su Windows 10`
