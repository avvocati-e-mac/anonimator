#!/usr/bin/env node
// Controllo grossolano del corpus. NON e' il rilevatore: e' il minimo che serve
// per sapere che ogni fixture contiene davvero il difetto che dichiara.
//
//   node tests/corpus-ocr/verify.mjs
//   node tests/corpus-ocr/verify.mjs geo-05
//
// Per ogni file: apre il PDF con MuPDF, renderizza la prima pagina, estrae il
// layer di testo e misura quanta parte di ogni riquadro di testo cade su
// inchiostro (copertura). Una scansione allineata sta sopra il 70%; una
// disallineata crolla. Unica eccezione prevista: geo-05, dove lo scostamento
// vale un'interlinea esatta e la copertura resta alta per costruzione — e'
// proprio il motivo per cui quel file esiste.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIRS = ['negativi', 'geometrici', 'testo', 'immagine', 'roundtrip', 'noti-non-coperti']
const SCALE = 150 / 72

/** Copertura minima attesa (null = nessun vincolo, il caso si valuta a occhio). */
const ATTESO = {
  negativi: 0.7,
  geometrici: null,
  testo: 0.7,
  immagine: 0.6,
  roundtrip: null,
  'noti-non-coperti': 0.7
}

async function analizza(mupdf, buf) {
  const doc = new mupdf.PDFDocument(buf)
  const pagine = doc.countPages()
  const out = { pagine, righe: 0, copertura: null, inchiostro: 0, immagini: 0, testo: '' }

  const page = doc.loadPage(0)
  const b = page.getBounds()
  const st = page.toStructuredText('preserve-images')
  const json = JSON.parse(st.asJSON())
  const righe = []
  for (const blk of json.blocks) {
    if (blk.type === 'image') { out.immagini++; continue }
    for (const ln of blk.lines || []) if (ln.text && ln.text.trim()) righe.push(ln)
  }
  out.righe = righe.length
  out.testo = st.asText().replace(/\s+/g, ' ').trim().slice(0, 60)

  // getPixels e' una vista viva sulla heap WASM: si copia subito e non si
  // chiamano altre API MuPDF nel frattempo (vedi sessione 051).
  const px = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceGray, false)
  const w = px.getWidth()
  const h = px.getHeight()
  const src = px.getPixels()
  const stride = Math.floor(src.length / h)
  const img = Uint8Array.from(src.subarray(0, stride * h))

  // Soglia: mediana grossolana meno 35 livelli.
  const isto = new Uint32Array(256)
  for (let i = 0; i < img.length; i++) isto[img[i]]++
  let acc = 0
  let mediana = 255
  for (let v = 0; v < 256; v++) { acc += isto[v]; if (acc > img.length / 2) { mediana = v; break } }
  const soglia = Math.max(20, mediana - 35)
  let scuri = 0
  for (let i = 0; i < img.length; i++) if (img[i] < soglia) scuri++
  out.inchiostro = scuri / (w * h)

  if (righe.length) {
    let dentro = 0
    let totali = 0
    for (const ln of righe) {
      const x0 = Math.round((ln.bbox.x - b[0]) * SCALE)
      // Fascia dei glifi, non l'intero box di riga: il bbox va da ascendente a
      // discendente, mentre l'inchiostro sta fra maiuscole e linea di base.
      // Misurare sull'intero box dava copertura ~35% su pagine perfettamente
      // allineate, cioe' 36 segnalazioni su un corpus sano. Stessi valori usati
      // da ocrLayerCheck (GLYPH_BAND_TOP/BOTTOM).
      const y0 = Math.round((ln.bbox.y + ln.bbox.h * 0.25 - b[1]) * SCALE)
      const x1 = Math.round((ln.bbox.x + ln.bbox.w - b[0]) * SCALE)
      const y1 = Math.round((ln.bbox.y + ln.bbox.h * 0.85 - b[1]) * SCALE)
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
          totali++
          if (img[y * stride + x] < soglia) dentro++
        }
      }
    }
    out.copertura = totali ? dentro / totali : 0
  }
  return out
}

async function main() {
  const filtro = process.argv[2] || ''
  const mupdf = (await import('mupdf')).default
  let problemi = 0
  for (const d of DIRS) {
    let files
    try { files = (await readdir(join(ROOT, d))).filter((f) => f.endsWith('.pdf')).sort() }
    catch { continue }
    if (!files.length) continue
    process.stdout.write(`\n${d}/\n`)
    for (const f of files) {
      if (filtro && !f.includes(filtro)) continue
      let r
      try { r = await analizza(mupdf, await readFile(join(ROOT, d, f))) }
      catch (e) { process.stdout.write(`  ${f.padEnd(32)} ERRORE ${e.message}\n`); problemi++; continue }
      const cop = r.copertura === null ? ' n/d ' : (r.copertura * 100).toFixed(0).padStart(4) + '%'
      const min = ATTESO[d]
      let nota = ''
      if (min !== null && r.copertura !== null && r.copertura < min) { nota = '  <-- copertura bassa'; problemi++ }
      process.stdout.write(
        `  ${f.padEnd(32)} pag ${r.pagine}  righe ${String(r.righe).padStart(3)}  ` +
        `img ${r.immagini}  inchiostro ${(r.inchiostro * 100).toFixed(1).padStart(5)}%  ` +
        `copertura ${cop}${nota}\n`
      )
    }
  }
  process.stdout.write(problemi ? `\n${problemi} segnalazioni da guardare.\n` : '\nNessuna anomalia.\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
