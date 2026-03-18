# Sessione 045 — Analisi warning CI "Node.js 20 deprecated"
**Data:** 2026-03-18
**Versione:** 1.4.0

## Obiettivo
Investigare i 4 warning "Node.js 20 actions are deprecated" che compaiono nella CI dopo la release v1.4.0, nonostante il fix già applicato in sessione 043.

## Decisioni prese

### Causa root identificata
Il warning **non viene dalle nostre action** (già aggiornate a @v5 in sessione 043), ma da `softprops/action-gh-release@v2` (riga 151 di `.github/workflows/release.yml`), action di terze parti che usa internamente Node 20. Non è controllabile da noi.

### Urgenza
GitHub rimuoverà il supporto Node 20 nelle Actions a **maggio 2026**. La CI funziona correttamente ora — nessun installer mancante, nessun errore reale.

### Soluzione pianificata (da implementare entro maggio 2026)
Sostituire `softprops/action-gh-release@v2` con `gh release create` via CLI (binario Go preinstallato su tutti i runner, nessuna dipendenza Node).

**File da modificare:** `.github/workflows/release.yml` — solo lo step `Create GitHub Release` nel job `release`.

**Schema della modifica:**
```yaml
# PRIMA (riga 150-177):
- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    name: "Anonimator ${{ github.ref_name }}"
    body: |
      ...testo formattato...
    files: |
      artifacts/mac-arm64-dmg/*.dmg
      ...

# DOPO:
- name: Create GitHub Release
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    VERSION="${GITHUB_REF_NAME#v}"
    NOTES=$(awk "/^## \[$VERSION\]/{found=1; next} found && /^## \[/{exit} found{print}" CHANGELOG.md)
    BODY="## Installazione

    Scarica il file per il tuo sistema operativo:
    - **Mac Apple Silicon (M1/M2/M3/M4):** \`*-arm64.dmg\`
    - **Mac Intel:** \`*-x64.dmg\`
    - **Windows:** \`*-setup.exe\`
    - **Linux:** \`*-linux-x64.AppImage\`

    Trascina \`Anonimator.app\` nella cartella Applicazioni, poi esegui una volta:
    \`\`\`bash
    sudo xattr -cr /Applications/Anonimator.app
    \`\`\`

    ---

    ${NOTES}"

    gh release create "$GITHUB_REF_NAME" \
      --title "Anonimator $GITHUB_REF_NAME" \
      --notes "$BODY" \
      artifacts/mac-arm64-dmg/*.dmg \
      artifacts/mac-x64-dmg/*.dmg \
      artifacts/windows-installer/*.exe \
      artifacts/linux-appimage/*.AppImage
```

## File modificati
Nessuno — sessione di sola analisi.

## Problemi noti / TODO prossima sessione
- [ ] **Entro metà aprile 2026:** implementare la sostituzione `softprops/action-gh-release@v2` → `gh release create` in `.github/workflows/release.yml`
