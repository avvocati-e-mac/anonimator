# Sessione 017 — Fix build macOS arm64 (xattr codesign)

**Data:** 2026-03-06
**Obiettivo:** Risolvere errore codesign durante `npm run dist:mac:arm64`

---

## Problema

Build falliva con:
```
resource fork, Finder information, or similar detritus not allowed
```

Causa: xattr di iCloud/Finder (`com.apple.quarantine`, metadata Finder, ecc.) sui binari Electron
copiati nell'`.app` da electron-builder. Il codesign Apple rifiuta file con questi attributi estesi.

Il workaround manuale `xattr -cr dist/mac-arm64/Anonimator.app` funzionava ma non era automatico.

---

## Soluzione implementata

### `afterPack.js` (nuovo file nella root)
Hook electron-builder che viene eseguito **dopo** la copia dei file nell'`.app` ma **prima** del codesign.
Esegue `xattr -cr <App>.app` automaticamente ad ogni build macOS.

- Solo macOS (`electronPlatformName !== 'darwin'` → skip)
- Usa `packager.appInfo.productFilename` per ricavare il nome corretto dell'`.app`
- L'errore xattr non blocca la build (try/catch) — meglio tentare il codesign che fallire qui

### `electron-builder.config.js`
Aggiunta chiave `afterPack: './afterPack.js'` in cima alla configurazione.

---

## File modificati
- `afterPack.js` — NUOVO
- `electron-builder.config.js` — aggiunta chiave `afterPack`

---

## Prossimi passi
- Eseguire `npm run dist:mac:arm64` per verificare che il fix funzioni end-to-end
- Se il codesign passa, il DMG è distribuibile (hardenedRuntime: false → no notarization)
