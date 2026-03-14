# Sessione 021 — Piano Build Windows + macOS unificata in GitHub Actions

**Data:** 2026-03-07
**Stato:** PIANIFICATO — da implementare in sessione futura

---

## Obiettivo

Un unico comando (`git tag v1.0.8 && git push origin v1.0.8`) produce automaticamente tutti gli artifact e li allega a una GitHub Release:
- `Anonimator-1.0.8-windows-x64-setup.exe`
- `Anonimator-1.0.8-arm64.dmg`
- `Anonimator-1.0.8-x64.dmg`

**GITHUB_TOKEN:** non richiede configurazione — automaticamente disponibile in Actions per repo pubblici.
**Intervento manuale richiesto:** solo il push del tag.

---

## Stato attuale del repo (verificato 2026-03-07)

| File | Stato | Note |
|------|-------|------|
| `build-resources/icon.ico` | Esiste (140 KB) | Nessuna conversione necessaria |
| `build-resources/icon.icns` | Esiste (2.3 MB) | Già usato per macOS |
| `electron-builder.config.js` sezioni `win`+`nsis` | Complete e corrette | Nessuna modifica necessaria |
| `package.json` script `dist:win` | Esiste | Nessuna modifica necessaria |
| `.github/` directory | Non esiste | Da creare da zero |

**Unica cosa da creare:** `.github/workflows/release.yml`

---

## Architettura: 3 job paralleli + 1 job Release

```
git tag v1.0.8 && git push origin v1.0.8
  ↓
GitHub Actions (3 job paralleli):
  ┌─ build-windows (windows-latest) → .exe
  ├─ build-mac-arm64 (macos-latest) → DMG arm64   [Apple Silicon]
  └─ build-mac-x64  (macos-13)      → DMG x64 Intel
  ↓ (quando tutti e 3 completati)
  release (ubuntu-latest)
    → estrae sezione corrente da CHANGELOG.md (in italiano)
    → aggiunge istruzioni installazione macOS + Windows
    → crea GitHub Release con tutti e 3 i file allegati
```

**Runner macOS:** `macos-latest` (Apple Silicon arm64) e `macos-13` (Intel x64) — npm installa automaticamente i binari sharp corretti per ciascun runner. Nessuno script ad-hoc.

**hdiutil in CI:** i runner usano `/Users/runner/` — non iCloud Drive — electron-builder funziona direttamente senza fallback.

---

## Changelog e istruzioni nella Release

Il job `release` estrae la sezione `## [x.y.z]` dal `CHANGELOG.md` (in italiano) e la usa come corpo della Release. Aggiunge automaticamente dopo:

**Istruzioni macOS:** `spctl --master-disable` + `sudo xattr -cr /Applications/Anonimator.app`

**Istruzioni Windows SmartScreen:**
- Compare solo al primo avvio del `setup.exe` — click "Ulteriori informazioni" → "Esegui comunque"
- NSIS installa in `%LOCALAPPDATA%` — nessun privilegio amministratore richiesto
- Nessun certificato necessario per ora

---

## Piano di test su branch dedicato

### Strategia
Usare `workflow_dispatch` (avvio manuale dalla UI GitHub) invece del trigger su tag. Permette di:
- Testare senza creare tag o Release reali
- Correggere errori sul branch senza toccare `master`
- Ripetere il test quante volte necessario

Solo quando il test è verde → merge su `master` e switch al trigger `push: tags: v*`.

### Step di esecuzione test

**Step 1 — Creare branch:**
```bash
git checkout -b feature/github-actions-release
```

**Step 2 — Creare `.github/workflows/release.yml`** (versione test, vedi sotto)

**Step 3 — Commit e push:**
```bash
git add .github/workflows/release.yml
git commit -m "ci: aggiungi workflow release GitHub Actions (test)"
git push -u origin feature/github-actions-release
```

**Step 4 — Avviare test manualmente su GitHub:**
1. https://github.com/avvocati-e-mac/anonimator/actions
2. Selezionare workflow "Release" → **"Run workflow"**
3. Selezionare branch `feature/github-actions-release` → **"Run workflow"**

**Step 5 — Monitorare** (10–20 min per job)

**Step 6 — Scaricare artifact e verificare:**
- `windows-installer` → installare su Windows, verificare avvio app e NER
- `mac-arm64-dmg` → verificare su Apple Silicon
- `mac-x64-dmg` → verificare su Intel

**Step 7 — Se test OK, merge su master:**
```bash
# Aggiornare workflow: workflow_dispatch → push tags + aggiungere job release completo
git add .github/workflows/release.yml
git commit -m "ci: workflow release pronto per produzione"
git checkout master
git merge --no-ff feature/github-actions-release
git push origin master
```

---

## Workflow versione TEST (workflow_dispatch)

```yaml
name: Release

on:
  workflow_dispatch:   # TEST: avvio manuale dalla UI GitHub Actions
  # push:
  #   tags:
  #     - 'v*'         # PRODUZIONE: attivare al merge su master

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build renderer + main
        run: npx electron-vite build
      - name: Package Windows installer
        run: npx electron-builder --win --x64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: dist/*-setup.exe
          retention-days: 3

  build-mac-arm64:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build renderer + main
        run: npx electron-vite build
      - name: Package macOS arm64 DMG
        run: npx electron-builder --mac --arm64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: mac-arm64-dmg
          path: dist/*.dmg
          retention-days: 3

  build-mac-x64:
    runs-on: macos-13
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build renderer + main
        run: npx electron-vite build
      - name: Package macOS x64 DMG
        run: npx electron-builder --mac --x64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: mac-x64-dmg
          path: dist/*.dmg
          retention-days: 3

  # job 'release' assente durante il test — nessuna Release reale viene creata
```

---

## Workflow versione PRODUZIONE (da applicare dopo test OK)

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - run: npm ci
      - run: npx electron-vite build
      - run: npx electron-builder --win --x64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: dist/*-setup.exe

  build-mac-arm64:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - run: npm ci
      - run: npx electron-vite build
      - run: npx electron-builder --mac --arm64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: mac-arm64-dmg
          path: dist/*.dmg

  build-mac-x64:
    runs-on: macos-13
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - run: npm ci
      - run: npx electron-vite build
      - run: npx electron-builder --mac --x64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: mac-x64-dmg
          path: dist/*.dmg

  release:
    needs: [build-windows, build-mac-arm64, build-mac-x64]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: windows-installer
          path: artifacts/
      - uses: actions/download-artifact@v4
        with:
          name: mac-arm64-dmg
          path: artifacts/
      - uses: actions/download-artifact@v4
        with:
          name: mac-x64-dmg
          path: artifacts/
      - name: Estrai changelog per questa versione
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          NOTES=$(awk "/^## \[$VERSION\]/{found=1; next} /^## \[/{if(found) exit} found{print}" CHANGELOG.md)
          echo "RELEASE_NOTES<<EOF" >> $GITHUB_ENV
          echo "$NOTES" >> $GITHUB_ENV
          echo "EOF" >> $GITHUB_ENV
      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
          body: |
            ${{ env.RELEASE_NOTES }}

            ---

            ### Installazione macOS
            L'app non è firmata né notarizzata. Eseguire **una volta sola** nel Terminale dopo l'installazione:
            ```bash
            spctl --master-disable
            ```
            Poi aprire **Impostazioni di Sistema → Privacy e Sicurezza** e selezionare **Dovunque**.
            ```bash
            sudo xattr -cr /Applications/Anonimator.app
            ```

            ### Installazione Windows
            Al primo avvio SmartScreen mostra "Windows ha protetto il PC" — è normale per app non firmate.
            Cliccare **"Ulteriori informazioni"** → **"Esegui comunque"**.
            L'installer non richiede diritti amministratore.
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Errori comuni attesi e soluzioni

| Errore | Causa probabile | Soluzione |
|--------|-----------------|-----------|
| `sharp` crash su Windows | Binari win32-x64 non trovati | `npm ci` li installa automaticamente; se persiste aggiungere `npm install @img/sharp-win32-x64 --force` |
| Artifact vuoto (0 bytes) | Path `dist/*-setup.exe` non corrisponde | Aggiungere step `ls dist/` prima dell'upload per debug |
| `hdiutil` error su macOS CI | Improbabile (non iCloud Drive) | Aggiungere `ELECTRON_BUILDER_CACHE` env se necessario |
| `Cannot find module 'mupdf'` | asarUnpack non applicato | Verificare che `--config electron-builder.config.js` sia passato |

---

## Checklist verifica finale

- [ ] Tutti e 3 i job completano in verde
- [ ] Gli artifact sono scaricabili dalla pagina del workflow
- [ ] Il .exe si installa su Windows senza errori
- [ ] L'app si avvia e carica il modello NER
- [ ] Il DMG arm64 funziona su Apple Silicon
- [ ] `master` non è stato toccato durante tutto il test
