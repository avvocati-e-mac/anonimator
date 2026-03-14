# Sessione 020 — Dark mode + Annulla + Fix Settings + Build arm64+x64

**Data:** 2026-03-06
**Branch:** `feature/darkmode-annulla-settings` → merge su `master`
**Versione:** 1.0.6 → 1.0.7

---

## Obiettivi

1. Fix bug Settings: campo Host mostrava `192.168.1.125:1234` invece di solo `192.168.1.125`
2. Pulsante Annulla in ProcessingScreen e BatchProcessingScreen
3. Fix Annulla in EntityReview e BatchReview (reset completo store)
4. Dark mode completa su tutti i componenti UI
5. Script automatico per build macOS arm64 + x64

---

## Modifiche effettuate

### Fix bug Settings Host (`SettingsScreen.tsx`)
- `extractHostFromUrl` restituiva `u.hostname + ":" + u.port` → ora restituisce solo `u.hostname`
- La porta è gestita dal preset selezionato tramite `buildBaseUrl`

### Pulsante Annulla (`ProcessingScreen.tsx`, `BatchProcessingScreen.tsx`)
- Aggiunto pulsante blu `bg-blue-600` che chiama `reset()` dallo store
- Non interrompe il main process (non implementato AbortController IPC), ma resetta visivamente il renderer
- Se il main process completa dopo, il risultato IPC viene ignorato (store già resettato)
- Prima iterazione: pulsante era `text-slate-400` — quasi invisibile. Poi `underline`. Infine blu pieno su richiesta utente.
- **Nota:** il bug era che il pulsante era in `ProcessingScreen` (file singolo) ma la schermata batch usa `BatchProcessingScreen` — componente separato. Fix applicato a entrambi.

### Fix Annulla EntityReview e BatchReview
- Prima: `onClick={() => setScreen('dropzone')}` — lasciava `filePath`/`entities` nello store
- Dopo: `onClick={reset}` — reset completo, drop successivo parte da stato pulito

### Dark mode
- `tailwind.config.js`: aggiunto `darkMode: 'class'`
- `src/renderer/index.html`: script anti-FOUC inline + CSP aggiornata con `'unsafe-inline'` per script
- `App.tsx`: hook `isDark`/`toggleDark` con persistenza `localStorage` chiave `'theme'`
- Toggle luna (`Moon`) / sole (`Sun`) da lucide-react in `DropZone` (accanto al gear) e `SettingsScreen` (header destra)
- Props `isDark: boolean` e `onToggleDark: () => void` passate da `App.tsx` a `DropZone` e `SettingsScreen`
- Palette dark: `bg-slate-900` body, `bg-slate-800` card/header, `border-slate-700`, `text-slate-100/400`
- Badge entità: versioni dark con `/40` opacity (es. `dark:bg-blue-900/40 dark:text-blue-300`)
- Componenti aggiornati: tutti (DropZone, ProcessingScreen, EntityReview, SuccessScreen, SettingsScreen, BatchProcessingScreen, BatchReview, BatchSuccessScreen, ErrorOverlay)

### Script build macOS arm64 + x64 (`scripts/build-mac.sh`)
- Ricerca confermata: universal binary con sharp NON è supportato (lovell/sharp#3622 — `.dylib` libvips arch-specific non mergeable con `lipo`)
- Strategia: due DMG separati prodotti in sequenza automatica
- Legge versioni sharp dai `package.json` in `node_modules/@img/`
- Step: build vite (una sola volta) → binari sharp arm64 → DMG arm64 → binari sharp x64 → DMG x64 → ripristino binari arm64
- Fallback hdiutil su Desktop per entrambi se electron-builder fallisce (iCloud Drive)
- Nuovo script npm: `dist:mac:both`
- `dist:mac:x64` corretto (era `--os=darwin --cpu=x64 sharp` — lento/bloccato)
- `electron-builder.config.js`: rimosso `arch: ['arm64']` hardcoded, ora viene passata da CLI

---

## File modificati

| File | Modifica |
|------|----------|
| `src/renderer/src/components/SettingsScreen.tsx` | Fix extractHostFromUrl + dark mode + props isDark/onToggleDark |
| `src/renderer/src/components/ProcessingScreen.tsx` | Pulsante Annulla blu + dark mode |
| `src/renderer/src/components/BatchProcessingScreen.tsx` | Pulsante Annulla blu + dark mode |
| `src/renderer/src/components/EntityReview.tsx` | Fix Annulla → reset() + dark mode |
| `src/renderer/src/components/BatchReview.tsx` | Fix Annulla → reset() + dark mode + tipo MergedEntity per EntityRow |
| `src/renderer/src/components/DropZone.tsx` | Toggle dark mode (Moon/Sun) + dark mode + props |
| `src/renderer/src/components/SuccessScreen.tsx` | Dark mode |
| `src/renderer/src/components/BatchSuccessScreen.tsx` | Dark mode |
| `src/renderer/src/components/ErrorOverlay.tsx` | Dark mode |
| `src/renderer/src/App.tsx` | Hook isDark/toggleDark, props a DropZone e SettingsScreen |
| `src/renderer/index.html` | Script anti-FOUC + CSP unsafe-inline script |
| `tailwind.config.js` | darkMode: 'class' |
| `scripts/build-mac.sh` | Script build arm64 + x64 automatico (nuovo) |
| `electron-builder.config.js` | Rimosso arch hardcoded, aggiornato commento |
| `package.json` | v1.0.7, dist:mac:x64 fix, dist:mac:both nuovo |
| `CHANGELOG.md` | Sezione [1.0.7] |
| `CLAUDE.md` | Sezione build arm64+x64 script |

---

## Build prodotte

- `dist/Anonimator-1.0.7-arm64.dmg` ✅ (Apple Silicon)
- `dist/Anonimator-1.0.7-x64.dmg` ✅ (Intel)

---

## Git

- Commit: `e6f75a6` su `feature/darkmode-annulla-settings`
- Merge no-ff: `da63d3d` su `master`
- Push: `origin/master` aggiornato

---

## Aggiornamento README

Aggiornato `README.md` per allinearlo allo stato attuale dell'app:
- Versione corrente (1.0.7) in cima
- Aggiunte funzionalità mancanti: dark mode, LLM locale opzionale, pseudonimi editabili, pulsante Annulla
- Sezione utenti finali (DMG) separata dalla sezione sviluppatori (da sorgente)
- `scripts/build-mac.sh` aggiunto nella struttura progetto
- TODO commento HTML per screenshot da aggiungere nella prossima sessione
- Push: commit `24d7ac7` su `master`

---

## Prossime sessioni

- **Aggiungere screenshot** al README (DropZone, revisione entità, dark mode) — TODO commento già inserito
- Testare DMG x64 su Mac Intel
- Valutare aggiunta formati `.md` tra quelli supportati
- Fix PDF: pseudonimi brevi spezzati su due righe a fine riga
- Fix "1 di ??" nel footer PDF (pdf-lib non legge totale pagine)
