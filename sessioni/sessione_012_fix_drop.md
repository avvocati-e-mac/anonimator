# Sessione 012 — Fix Drop File + CHANGELOG

**Data:** 2026-03-05
**Versione:** 1.0.1 → 1.0.2

---

## Problema risolto

### Bug: "Impossibile leggere il percorso del file" al drag & drop

**Sintomo:** Trascinando qualsiasi file nella finestra dell'app compariva immediatamente il dialog di errore "Impossibile leggere il percorso del file. Riprova." senza avviare l'elaborazione.

**Causa radice:** `react-dropzone` crea copie/wrapper degli oggetti `File` originali dall'evento `drop` prima di passarli al callback `onDrop`. `webUtils.getPathForFile` di Electron funziona esclusivamente con oggetti `File` **originali** dell'evento nativo del browser — gli oggetti clonati/wrappati da `react-dropzone` non hanno il binding nativo Electron e restituiscono stringa vuota.

**Soluzione:** Aggiunto un `useEffect` in `DropZone.tsx` che registra un listener `drop` in **capture phase** (`addEventListener('drop', handler, true)`) sulla finestra. Questo listener viene eseguito prima che `react-dropzone` elabori l'evento, quindi i `File` objects sono ancora originali. Il path viene salvato in un `React.useRef` e letto nell'`onDrop` di react-dropzone.

```typescript
// Capture phase: si attiva prima di react-dropzone
useEffect(() => {
  const handleNativeDrop = (e: DragEvent) => {
    const file = e.dataTransfer?.files[0]
    if (file) {
      nativeDropPathRef.current = window.electronAPI.getPathForFile(file) || ''
    }
  }
  window.addEventListener('drop', handleNativeDrop, true)
  return () => window.removeEventListener('drop', handleNativeDrop, true)
}, [])
```

---

## File modificati

- `src/renderer/src/components/DropZone.tsx` — fix drop con capture phase listener
- `package.json` — versione 1.0.1 → 1.0.2
- `CHANGELOG.md` — creato (nuovo file, storico versioni)
- `CLAUDE.md` — aggiunta regola 5b su obbligo aggiornamento CHANGELOG ad ogni bump versione

---

## Verifiche effettuate

- `npm run typecheck` — nessun errore
- Test manuale con PDF (8 pagine): drop funzionante, NER + LLM completati, output generato correttamente
- Log confermano: `Inizio elaborazione documento { format: 'pdf' }` → `Documento anonimizzato { entitiesReplaced: 18 }`

---

## Note

- La sessione è stata avviata direttamente con `npm start` e monitorata in background
- Il fix è minimale e non altera l'architettura di sicurezza (sandbox=true mantenuto)
- `webUtils.getPathForFile` rimane nel preload come da design originale
