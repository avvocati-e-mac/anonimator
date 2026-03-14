# Sessione 022 — GitHub Actions Release Workflow

**Data:** 2026-03-07
**Versione:** 1.0.7 (nessun bump — solo CI/CD)

---

## Obiettivo

Implementare un workflow GitHub Actions per la build automatica dei 3 artifact di release:
- `windows-installer` — `.exe` NSIS x64
- `mac-arm64-dmg` — DMG Apple Silicon
- `mac-x64-dmg` — DMG Intel

---

## File creati

- `.github/workflows/release.yml` — workflow con trigger `workflow_dispatch` (test manuale)

---

## Strategia adottata

Test su branch dedicato `feature/github-actions-release`, poi merge immediato su `master` perché GitHub Actions richiede che il workflow sia nel branch default per essere visibile nell'UI.

Trigger: `workflow_dispatch` (avvio manuale). Il trigger `push: tags: v*` è commentato — da attivare quando si passa in produzione.

---

## Problemi risolti durante il test

### 1. `macos-13` ritirato (4 dicembre 2025)
- **Errore:** `The configuration 'macos-13-us-default' is not supported`
- **Causa:** GitHub ha ritirato i runner macOS Intel (`macos-13`, `macos-12`) a fine 2025
- **Soluzione:** Cross-compile x64 da runner ARM (`macos-latest`) con install forzato dei binari sharp x64:
  ```yaml
  runs-on: macos-latest
  # + step aggiuntivo:
  run: npm install @img/sharp-darwin-x64 @img/sharp-libvips-darwin-x64 --force --no-save
  ```
- **Nota Gemini:** runner Intel ancora disponibili come `macos-15-intel` ma solo su piani a pagamento

### 2. Icona Electron di default invece del robot arancione
- **Causa:** `npx electron-builder --mac --arm64` senza `--config electron-builder.config.js`
- **Effetto:** electron-builder ignorava tutta la config custom (icona, asarUnpack, artifactName, beforePack/afterPack)
- **Fix:** aggiunto `--config electron-builder.config.js` a tutti e 3 i comandi di packaging

### 3. Artifact Windows non trovato (`dist/*-setup.exe`)
- **Causa:** path glob non abbastanza ampio + flag `if-no-files-found` mancante
- **Fix:** aggiunto `dist/*.exe` come fallback e `if-no-files-found: warn`
- **Nota:** con il fix `--config` il nome file sarà `Anonimator-1.0.7-windows-x64-setup.exe` come da `artifactName` in config

---

## Stato finale workflow (run #5 — commit fc01361)

Tutti e 3 i job verdi in 4m 59s:
- `build-windows` ✅ 4m 42s
- `build-mac-arm64` ✅ 3m 24s
- `build-mac-x64` ✅ 2m 59s

Artifact prodotti:
- `mac-arm64-dmg` 245 MB ✅
- `mac-x64-dmg` 257 MB ✅
- `windows-installer` 216 MB ✅

**Nota:** run #5 usava ancora il commit prima del fix `--config` — le icone erano sbagliate (atomo Electron). Run #6 (in corso) usa il fix e dovrebbe avere le icone corrette.

---

## Commit della sessione

| Commit | Descrizione |
|--------|-------------|
| `04c554a` | ci: aggiungi workflow release GitHub Actions (test) |
| `f7c87ed` | Merge feature/github-actions-release → master |
| `8318162` | ci: fix runner x64 macos-13 → macos-12 |
| `d6a0863` | ci: fix artifact path Windows (aggiungi dist/*.exe come fallback) |
| `10b446c` | ci: fix runner x64 macos-12 → macos-13-large (non supportato) |
| `aab51bb` | ci: fix runner x64 → macos-13 (ritirato dic 2025) |
| `ef61356` | ci: fix build-mac-x64 — cross-compile da macos-latest ARM |
| `fc01361` | docs: aggiungi sezione TODO al README |
| `898f1f8` | ci: aggiungi --config electron-builder.config.js a tutti i job |

---

## Prossimi passi

1. **Verificare run #6** — scaricare `mac-arm64-dmg` e controllare che l'icona sia il robot arancione
2. **Testare .exe su Windows** — installare e verificare avvio + caricamento modello NER
3. **Promuovere a produzione** — modificare il workflow:
   - Commentare `workflow_dispatch`
   - Decommentare `push: tags: v*`
   - Aggiungere job `release` con `softprops/action-gh-release` per creare Release GitHub con artifact allegati
4. **Primo tag di produzione:**
   ```bash
   git tag v1.0.8 && git push origin v1.0.8
   ```

---

## Workflow finale (stato attuale)

```yaml
name: Release

on:
  workflow_dispatch:
  # push:
  #   tags:
  #     - 'v*'

jobs:
  build-windows:
    runs-on: windows-latest
    # npm ci → electron-vite build → electron-builder --win --x64 --config ...

  build-mac-arm64:
    runs-on: macos-latest
    # npm ci → electron-vite build → electron-builder --mac --arm64 --config ...

  build-mac-x64:
    runs-on: macos-latest  # ARM, cross-compila x64
    # npm ci → install sharp-darwin-x64 --force → electron-vite build → electron-builder --mac --x64 --config ...
```
