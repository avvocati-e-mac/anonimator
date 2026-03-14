# Sessione 027 — Fix Windows: PDF worker URL + onnxruntime crash

**Data:** 2026-03-07
**Versioni rilasciate:** v1.1.1, v1.1.2

---

## Problema segnalato

Due bug distinti su Windows, entrambi segnalati dopo il rilascio di v1.1.0:

**Bug A — PDF non si apre (Win 10 e Win 11):**
```
Setting up fake worker failed: "Only URLs with a scheme in: file, data, node,
and electron are supported by the default ESM loader. On Windows, absolute
paths must be valid file:// URLs. Received protocol 'c:'"
```
Causa: `pdfParser.ts` concatenava il path del worker come stringa (`C:\...`) invece di un URL valido.

**Bug B — App non parte (Win 10, crash main process):**
```
Error: Impossibile trovare il modulo specificato.
\\?\C:\Users\andrea\AppData\...\onnxruntime_binding.node
```
Causa: `onnxruntime-node/dist/binding.js` usa `require('../bin/...')` con `__dirname` che punta **dentro** `app.asar`. Su Windows, `dlopen()` non può aprire file `.node` dall'interno di un asar archivio, anche se `asarUnpack` è configurato correttamente.

---

## Fix implementati

### v1.1.1 — Fix Bug A + tentativo Fix Bug B

**File: `src/main/parsers/pdfParser.ts`**
- Aggiunto `import { pathToFileURL } from 'url'`
- Sostituita concatenazione stringa con `path.join()` + `pathToFileURL().toString()`
- Produce `file:///C:/...` su Windows e `file:///path/...` su macOS/Linux

**File: `.github/workflows/release.yml`**
- Aggiunto step `npx @electron/rebuild --force` nel job `build-windows`
- Serve per ricompilare i moduli nativi con l'ABI di Electron corretto
- NON ha risolto Bug B (il problema non era la ricompilazione ma il path resolution)

Risultato: Bug A risolto su Win 10 e Win 11. Bug B ancora presente su Win 10.

---

### v1.1.2 — Fix definitivo Bug B (Win 10)

**File: `src/main/index.ts`**

Aggiunta patch `Module._resolveFilename` all'inizio del file, prima di qualunque import:

```typescript
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const Module = _require('module') as { _resolveFilename: (...args: unknown[]) => string }
const _origResolve = Module._resolveFilename.bind(Module)
Module._resolveFilename = function (request: unknown, ...rest: unknown[]): string {
  const resolved: string = _origResolve(request, ...rest)
  if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
    if (resolved.endsWith('.node') || resolved.includes('onnxruntime')) {
      return resolved.replace('app.asar', 'app.asar.unpacked')
    }
  }
  return resolved
}
```

**Meccanismo:** intercetta tutti i `require()` del main process. Se il path risolto punta dentro `app.asar` e riguarda un file `.node` o `onnxruntime`, lo reindirizza automaticamente verso `app.asar.unpacked`. Funziona indipendentemente da come il modulo interno costruisce il suo path.

**Perché Win 10 e non Win 11:** probabilmente differenza di versione del runtime C/C++ (VCRUNTIME) o comportamento diverso del filesystem virtuale asar tra le due versioni. Su Win 11 `dlopen()` riesce a caricare `.node` dall'asar, su Win 10 no. La patch risolve entrambi i casi in modo preventivo.

---

## File modificati

| File | Modifica |
|------|----------|
| `src/main/parsers/pdfParser.ts` | pathToFileURL per worker pdfjs |
| `src/main/index.ts` | Patch Module._resolveFilename |
| `.github/workflows/release.yml` | electron-rebuild nel job Windows |
| `package.json` | 1.1.0 → 1.1.1 → 1.1.2 |
| `CHANGELOG.md` | Sezioni v1.1.1 e v1.1.2 |

---

## Stato

- v1.1.1: CI completata, Bug A risolto, Bug B ancora presente su Win 10
- v1.1.2: CI in corso (tag pushato), da testare su Win 10
- Bug B su Win 10 da verificare con Andrea

---

## Prossimi passi

- Attendere test di v1.1.2 su Win 10 da parte dell'utente
- Se il crash persiste, investigare se il problema riguarda altri moduli nativi oltre a onnxruntime (es. sharp, mupdf) ampliando la condizione nella patch
- TODO aperto: "D'Angiolino troncato" — redaction PDF spezza il token sull'apostrofo
- TODO aperto: pdfParser.ts — testo strutturato Markdown-like (branch feat/pdf-structured-parsing)
