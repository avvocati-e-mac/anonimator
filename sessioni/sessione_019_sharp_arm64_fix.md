# Sessione 019 — Fix sharp darwin-arm64 crash al lancio

**Data:** 2026-03-06
**Versione:** 1.0.5 → 1.0.6

---

## Problema

Al lancio del DMG arm64 su macchina Apple Silicon compariva:

```
Uncaught Exception:
Error: Could not load the "sharp" module using the darwin-arm64 runtime
```

Stack trace: `app.asar/node_modules/sharp/lib/constructor.js` → cercava binario `.node` per darwin-arm64 che non era presente.

---

## Diagnosi

### Causa radice
La macchina di build era **x64 (Intel)**, non arm64. Quando si fa `npm install`, npm scarica i binari nativi per la piattaforma corrente (x64). Il DMG arm64 includeva quindi:

- `@img/sharp-darwin-x64` ✅ (presente)
- `@img/sharp-libvips-darwin-x64` ✅ (presente)
- `@img/sharp-darwin-arm64` ❌ (mancante)
- `@img/sharp-libvips-darwin-arm64` ❌ (mancante)

### Perché sharp è nel bundle
`@huggingface/transformers` importa `sharp` a livello **top-level** nel suo bundle (`transformers.node.mjs`, riga 6: `import * as sharp from "sharp"`). Anche se l'app non usa mai funzionalità immagine di transformers, il modulo viene caricato e crasha subito cercando il binario nativo.

### Comandi di indagine usati
```bash
# Verificare quali binari @img sono installati
ls node_modules/@img/

# Verificare se sharp viene importato nel codice proprio
grep -r "sharp" --include="*.ts" src/  # → nessun risultato

# Verificare come transformers.js importa sharp
grep -n "require.*sharp\|import.*sharp" node_modules/@huggingface/transformers/dist/transformers.node.mjs
# → riga 6: import * as __WEBPACK_EXTERNAL_MODULE_sharp__ from "sharp";

# Verificare se sharp è dipendenza diretta o opzionale di transformers
node -e "const p = require('./node_modules/@huggingface/transformers/package.json'); console.log(p.dependencies?.sharp)"
# → "^0.34.1" (dipendenza diretta, non opzionale)
```

---

## Soluzione

### Installazione binari arm64 su macchina x64

`npm install --os=darwin --cpu=arm64 sharp` era il comando teoricamente corretto, ma su questa configurazione era bloccato (timeout di rete sul download dei prebuilt).

**Comando che ha funzionato:**
```bash
npm install @img/sharp-darwin-arm64@0.34.5 @img/sharp-libvips-darwin-arm64@1.2.4 --force --no-save
```

- `--force` bypassa il check di piattaforma (npm blocca l'installazione di pacchetti per architettura diversa da quella host)
- `--no-save` non modifica `package.json` (sono binari temporanei di build, non dipendenze)
- Le versioni `0.34.5` e `1.2.4` corrispondono alle versioni dei binari x64 già installati

**Come trovare le versioni corrette:**
```bash
cat node_modules/@img/sharp-darwin-x64/package.json | python3 -m json.tool | grep '"version"'
# → "0.34.5"
cat node_modules/@img/sharp-libvips-darwin-x64/package.json | python3 -m json.tool | grep '"version"'
# → "1.2.4"
```

### Problema secondario: hdiutil su iCloud Drive

`npx electron-builder --mac --arm64` falliva nella fase di creazione DMG con:
```
hdiutil: create failed - Risorsa momentaneamente non disponibile
```

Causa: `hdiutil` non riesce a creare DMG dentro cartelle sincronizzate da iCloud Drive (il progetto è in `~/Library/Mobile Documents/com~apple~CloudDocs/`).

**Soluzione:** creare il DMG manualmente sul Desktop (fuori da iCloud):
```bash
hdiutil create -volname "Anonimator" \
  -srcfolder "dist/mac-arm64/Anonimator.app" \
  -ov -format UDZO \
  ~/Desktop/Anonimator-1.0.6-arm64.dmg
```

---

## Modifiche ai file

### `package.json`
- Script `dist:mac:arm64` aggiornato per installare i binari arm64 prima del packaging
- Aggiunto fallback automatico con `hdiutil` sul Desktop se electron-builder fallisce
- Versione 1.0.5 → 1.0.6

```json
"dist:mac:arm64": "npx electron-vite build && npm install @img/sharp-darwin-arm64@0.34.5 @img/sharp-libvips-darwin-arm64@1.2.4 --force --no-save && (npx electron-builder --mac --arm64 --config electron-builder.config.js || (echo 'DMG fallback su Desktop...' && hdiutil create -volname Anonimator -srcfolder dist/mac-arm64/Anonimator.app -ov -format UDZO ~/Desktop/Anonimator-arm64.dmg))"
```

### `CHANGELOG.md`
- Aggiunta sezione `## [1.0.6] - 2026-03-06`

---

## Note per il futuro

- Se si aggiorna `sharp` (es. da 0.34.5 a 0.35.x), aggiornare le versioni hardcoded nello script `dist:mac:arm64`
- Se si aggiorna `@huggingface/transformers`, verificare se cambia la versione di sharp richiesta: `cat node_modules/@huggingface/transformers/package.json | grep sharp`
- Alternativa a lungo termine: aprire issue su huggingface/transformers per rendere sharp un'optionalDependency (non caricato se non usato)
- Il problema si presenta SOLO quando si builda arm64 da macchina x64. Se si builda da macchina arm64, `npm install` installa già i binari giusti automaticamente.

---

## Commit

`50f6c05` fix: sharp darwin-arm64 binaries + DMG fallback su Desktop v1.0.6
