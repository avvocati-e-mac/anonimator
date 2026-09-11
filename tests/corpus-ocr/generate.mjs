#!/usr/bin/env node
// Generatore deterministico del corpus di riferimento per il controllo
// "layer OCR allineato?" sui PDF scansionati.
//
//   node tests/corpus-ocr/generate.mjs              tutto tranne roundtrip/
//   node tests/corpus-ocr/generate.mjs --roundtrip  anche roundtrip/ (richiede Tesseract)
//   node tests/corpus-ocr/generate.mjs --only geo-05
//
// TUTTI I DATI SONO SINTETICI E MANIFESTAMENTE FINTI. Vedi README.md.

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { createDoc, drawLines, drawRule, fillCm } from './lib/doc.mjs'
import {
  createCanvas, fillRect, strokeCircle, strokePath, mapPixels, addNoise, rng,
  encodeFlate, encodeJpeg, encodeCcittG4, encodeIndexed4, encodeImageMask,
  blurCanvas, resizeCanvas
} from './lib/raster.mjs'
import { PAGE, STYLE, ATTO, FRONTESPIZIO, layout, repeatBlocks, variedBlocks, tableBlocks } from './lib/layout.mjs'
import { translate, scaleAbout, rotateAbout, mirrorX, mirrorY, mul, IDENTITY } from './lib/text.mjs'
import { renderPageToCanvas, extractLines } from './lib/render.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))

/** 200 DPI: x-height di 14 px, sopra la soglia Tesseract di 10 px. */
const DPI = 200
const CX = PAGE.w / 2
const CY = PAGE.h / 2

// ─── Costruttori condivisi ───────────────────────────────────────────────────

/**
 * Documento "scansione": un raster per pagina piu' un layer di testo invisibile.
 * Tutte le fixture geometriche sono questa funzione con una matrice diversa.
 */
async function scanDoc(opt = {}) {
  const o = {
    blocks: ATTO,
    layoutOpts: {},
    dpi: DPI,
    paper: 250,
    ink: 25,
    encode: 'flate',
    jpegQuality: 40,
    page: PAGE,
    sheet: null,
    mediaBox: null,
    cropBox: null,
    rotate: 0,
    userUnit: null,
    fontOpts: {},
    textTransform: null,
    textMode: 'lines',
    renderMode: 3,
    repeat: 1,
    rasterRot: 0,
    rasterDims: null,
    ...opt
  }

  const sheet = o.sheet || { x: 0, y: 0, w: o.page.w, h: o.page.h }
  const pagesLines = layout(o.blocks, { page: { w: sheet.w, h: sheet.h }, ...o.layoutOpts })
  const doc = createDoc()
  const font = doc.font(o.fontOpts)
  const [rw, rh] = o.rasterDims || [
    Math.round((sheet.w * o.dpi) / 72),
    Math.round((sheet.h * o.dpi) / 72)
  ]
  const sx = rw / sheet.w
  const sy = rh / sheet.h
  const mb = o.mediaBox || [0, 0, o.page.w, o.page.h]

  for (let i = 0; i < pagesLines.length; i++) {
    const lines = pagesLines[i]
    let c = createCanvas(rw, rh, o.paper)
    drawLines(c, lines, { sx, sy, ink: o.ink, rotDeg: o.rasterRot })
    if (o.decorate) o.decorate(c, { sx, sy, ink: o.ink, pageIndex: i, lines })
    if (o.postProcess) c = await o.postProcess(c)

    const enc =
      o.encode === 'jpeg'
        ? await encodeJpeg(c, o.jpegQuality)
        : o.encode === 'indexed'
          ? encodeIndexed4(c, PALETTE16)
          : encodeFlate(c)
    const ref = doc.addImage({ w: rw, h: rh, bytes: enc.bytes, dict: enc.dict, extra: o.imageExtra })

    const textLines = o.mapText ? o.mapText(lines, i, pagesLines) : lines
    const T = typeof o.textTransform === 'function' ? o.textTransform(i) : o.textTransform

    doc.addPage({
      size: o.page,
      mediaBox: mb,
      cropBox: o.cropBox,
      rotate: o.rotate,
      userUnit: o.userUnit,
      images: [{ ref, cm: o.imageCm || fillCm(mb[0] + sheet.x, mb[1] + sheet.y, sheet.w, sheet.h) }],
      text:
        textLines && textLines.length
          ? {
              lines: textLines,
              fontRef: font,
              transform: T,
              renderMode: o.renderMode,
              mode: o.textMode,
              repeat: o.repeat,
              fillGray: o.fillGray,
              extraCharSpacing: o.extraCharSpacing,
              blockStart: o.blockStart
            }
          : undefined
    })
  }
  return doc.toBuffer()
}

const PALETTE16 = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]

/** PDF digitale nativo: testo vettoriale visibile, nessuna immagine. */
function digitalDoc(blocks = ATTO, layoutOpts = {}) {
  const pagesLines = layout(blocks, { page: PAGE, ...layoutOpts })
  const doc = createDoc()
  for (const lines of pagesLines) doc.addPage({ visible: { lines } })
  return doc.toBuffer()
}

/** Timbro tondo e firma a mano: molto inchiostro che l'OCR non legge. */
function decorateTimbro(c, ctx) {
  const { sx, sy } = ctx
  const cx = 430 * sx
  const cy = 700 * sy
  strokeCircle(c, cx, cy, 62 * sx, 3 * sx, 60)
  strokeCircle(c, cx, cy, 52 * sx, 2 * sx, 60)
  for (let i = 0; i < 3; i++) fillRect(c, cx - 40 * sx, cy - 12 * sy + i * 11 * sy, 80 * sx, 5 * sy, 60)
  const r = rng(20260911)
  const pts = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    pts.push([
      (120 + t * 200) * sx,
      (720 + Math.sin(t * 9) * 16 + (r() - 0.5) * 6) * sy
    ])
  }
  strokePath(c, pts, 2.5 * sx, 35)
}

/** Righelli della tabella densa. */
function decorateTabella(c, ctx) {
  const { sx, sy } = ctx
  const x0 = STYLE.margin
  const w = PAGE.w - 2 * STYLE.margin
  for (let r = 0; r <= 18; r++) {
    drawRule(c, x0, STYLE.margin - 4 + r * STYLE.leading, w, { sx, sy, thickness: Math.max(1, sx), ink: 70 })
  }
  for (const cx of [0, 13, 45, 69, 93]) {
    const x = x0 + cx * STYLE.charW
    fillRect(c, x * sx, (STYLE.margin - 4) * sy, Math.max(1, sx), 18 * STYLE.leading * sy, 70)
  }
}

// ─── Catalogo ────────────────────────────────────────────────────────────────

const FIXTURES = []
const fix = (dir, name, build) => FIXTURES.push({ dir, name, build })

// ─── negativi/ — nessun allarme. E' il gruppo che misura i falsi positivi. ────

fix('negativi', 'neg-01-digitale-nativo.pdf', async () => digitalDoc())

fix('negativi', 'neg-02-allineato-flate.pdf', () => scanDoc())

fix('negativi', 'neg-03-allineato-jpeg.pdf', () =>
  scanDoc({
    encode: 'jpeg',
    jpegQuality: 40,
    postProcess: async (c) => {
      addNoise(c, rng(1003), 5)
      return c
    }
  }))

fix('negativi', 'neg-05-slop-3pt.pdf', () => scanDoc({ textTransform: translate(0, -3) }))

fix('negativi', 'neg-06-glyphless.pdf', () =>
  scanDoc({ fontOpts: { baseFont: 'GlyphLessFont' } }))

fix('negativi', 'neg-07-timbro.pdf', () => scanDoc({ decorate: decorateTimbro }))

fix('negativi', 'neg-08-tabella-densa.pdf', () =>
  scanDoc({ blocks: tableBlocks(), decorate: decorateTabella }))

fix('negativi', 'neg-09-carta-grigia.pdf', () => scanDoc({ paper: 205, ink: 30 }))

fix('negativi', 'neg-10-due-colonne.pdf', () => scanDoc({ layoutOpts: { columns: 2 } }))

fix('negativi', 'neg-11-quasi-vuota.pdf', () => scanDoc({ blocks: FRONTESPIZIO }))

fix('negativi', 'neg-12-pagina-scura.pdf', () =>
  scanDoc({
    blocks: [
      { k: 'b' },
      { k: 'r', t: 'IMG 0421' },
      { k: 'r', t: 'ALLEGATO 7' },
      { k: 'r', t: 'DSC 1180' }
    ],
    ink: 200,
    paper: 60,
    encode: 'jpeg',
    jpegQuality: 45,
    postProcess: async (c) => {
      // Foto a piena pagina: fondo scuro con gradiente e grana.
      mapPixels(c, (x, y, v) => (v > 150 ? v : 30 + 50 * (x / c.w) + 40 * (y / c.h)))
      addNoise(c, rng(1012), 14)
      return c
    }
  }))

fix('negativi', 'neg-13-misto.pdf', async () => {
  // Pagina 1 digitale nativa, pagina 2 scansione allineata: caso frequentissimo
  // negli allegati PEC (atto nativo + ricevuta scansionata).
  const pagesLines = layout(ATTO)
  const lines = pagesLines[0]
  const doc = createDoc()
  const font = doc.font()
  doc.addPage({ visible: { lines } })
  const rw = Math.round((PAGE.w * DPI) / 72)
  const rh = Math.round((PAGE.h * DPI) / 72)
  const c = createCanvas(rw, rh, 250)
  drawLines(c, lines, { sx: rw / PAGE.w, sy: rh / PAGE.h, ink: 25 })
  const enc = encodeFlate(c)
  const ref = doc.addImage({ w: rw, h: rh, bytes: enc.bytes, dict: enc.dict })
  doc.addPage({ images: [{ ref, cm: fillCm(0, 0, PAGE.w, PAGE.h) }], text: { lines, fontRef: font } })
  return doc.toBuffer()
})

fix('negativi', 'neg-14-margini-bianchi.pdf', () =>
  // Il foglio scansionato e' piu' piccolo della pagina: raster in [30,40]-[565,802].
  scanDoc({ sheet: { x: 30, y: 40, w: 535, h: 762 }, textTransform: translate(30, -40) }))

// ─── geometrici/ — devono dare misaligned ────────────────────────────────────

fix('geometrici', 'geo-01-dy-6pt.pdf', () => scanDoc({ textTransform: translate(0, -6) }))
fix('geometrici', 'geo-02-dy-20pt.pdf', () => scanDoc({ textTransform: translate(0, -20) }))
fix('geometrici', 'geo-03-dx-15pt.pdf', () => scanDoc({ textTransform: translate(15, 0) }))
fix('geometrici', 'geo-04-diagonale.pdf', () => scanDoc({ textTransform: translate(9, -9) }))

// IL CASO PIU' PERICOLOSO: lo scostamento vale esattamente un'interlinea, quindi
// ogni riga di testo cade su un'altra barretta. La copertura resta ~100%: solo un
// confronto per riga (lunghezze, ordine) puo' accorgersene.
fix('geometrici', 'geo-05-una-riga.pdf', () =>
  scanDoc({ textTransform: translate(0, -STYLE.leading) }))

fix('geometrici', 'geo-06-due-righe.pdf', () =>
  scanDoc({ textTransform: translate(0, -2 * STYLE.leading) }))

// Layer espresso a 200 DPI su pagina renderizzata a 300: fattore 200/300.
fix('geometrici', 'geo-07-scala-200-300.pdf', () =>
  scanDoc({ textTransform: scaleAbout(200 / 300, 200 / 300, 0, PAGE.h) }))

// Deriva dell'1%: perfetto in cima, ~7,8 pt in fondo alla pagina.
fix('geometrici', 'geo-08-scala-1pct.pdf', () =>
  scanDoc({ textTransform: scaleAbout(1.01, 1.01, 0, PAGE.h) }))

fix('geometrici', 'geo-09-cropbox.pdf', () =>
  scanDoc({ cropBox: [30, 40, 565, 802], textTransform: translate(-30, -40) }))

// MediaBox con origine non nulla: il produttore del layer l'ha ignorata.
fix('geometrici', 'geo-10-mediabox-origine.pdf', () =>
  scanDoc({ mediaBox: [20, 30, 615, 872], textTransform: translate(0, -30) }))

fix('geometrici', 'geo-11-rotate-90.pdf', () =>
  scanDoc({ rotate: 90, textTransform: rotateAbout(90, CX, CY) }))

fix('geometrici', 'geo-12-rotate-180.pdf', () =>
  scanDoc({ rotate: 180, textTransform: rotateAbout(180, CX, CY) }))

// Asse y invertito: la prima riga di testo finisce sull'ultima riga di immagine.
fix('geometrici', 'geo-13-capovolto.pdf', () => scanDoc({ textTransform: mirrorY(CY) }))

fix('geometrici', 'geo-14-specchiato.pdf', () => scanDoc({ textTransform: mirrorX(CX) }))

// Immagine gia' raddrizzata, layer alle posizioni precedenti al deskew.
fix('geometrici', 'geo-15-deskew.pdf', () =>
  scanDoc({ textTransform: rotateAbout(1.5, CX, CY) }))

// Scansione storta di 3 gradi, layer dritto.
fix('geometrici', 'geo-16-obliqua.pdf', () => scanDoc({ rasterRot: 3 }))

// /UserUnit 2: MuPDF lo ignora in rendering, quindi l'osservabile e' un errore
// di scala 2x. Resta utile per verificare che il parser non si rompa sul campo.
fix('geometrici', 'geo-17-userunit.pdf', () =>
  scanDoc({ userUnit: 2, textTransform: scaleAbout(0.5, 0.5, 0, PAGE.h) }))

// Layer della pagina N appoggiato sulla N+1.
fix('geometrici', 'geo-18-pagina-sfasata.pdf', () =>
  scanDoc({
    // variedBlocks, non repeatBlocks: con tre pagine identiche lo spostamento
    // del layer di una pagina non sarebbe osservabile da nessun rilevatore.
    blocks: variedBlocks(ATTO, 3),
    mapText: (lines, i, all) => all[(i + 1) % all.length]
  }))

// Tutto il testo in un unico blocco all'origine, nessuna posizione per riga.
fix('geometrici', 'geo-19-blocco-unico.pdf', () =>
  scanDoc({ textMode: 'block', blockStart: [0, PAGE.h] }))

// Layer OCR solo sulla prima delle tre pagine: verifica il campionamento.
fix('geometrici', 'geo-20-solo-prima-pagina.pdf', () =>
  scanDoc({
    blocks: repeatBlocks(ATTO, 3),
    mapText: (lines, i) => (i === 0 ? lines : null)
  }))

// ─── testo/ — difetti di codifica. Geometria corretta, testo inservibile. ─────

/** Pseudo-latino: lettere plausibili, nessuna parola italiana, nessun dato reale. */
const PSEUDO = [
  { k: 'h', t: 'TRIBUNAL ORDINARIUM DE CIVITATE FICTA' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "Lorim ipsun dolur sit amel, consectatur adipiscang elit, sed dium nonumi eirmud tempor " +
      "invidunt ut labare et dolare magnam aliquyam erat, sed diam voluptua vel illum qui " +
      "blandit praesant luptatum zzril delenat augue duis dolure te feugat nulla facilisi."
  },
  {
    k: 'p',
    t:
      "Nam liber tempur cum solutas nobis eleifand optian congue nihil imperdiat doming id quod " +
      "mazim placerat facer possim assum typi non habent claritatem insitam est usus legentis."
  },
  {
    k: 'p',
    t:
      "Mirum notare quam littera gothica quam nunc putamus parum claram anteposuerit litterarum " +
      "formas humanitatis per seacula quarta decima et quinta decima eodem modo typi."
  },
  { k: 'b' },
  { k: 'r', t: 'Civitas Ficta, MMXXII' }
]

fix('testo', 'txt-01-no-tounicode.pdf', () => scanDoc({ fontOpts: { toUnicode: 'none' } }))
fix('testo', 'txt-02-pua.pdf', () => scanDoc({ fontOpts: { toUnicode: 'pua' } }))
fix('testo', 'txt-03-fffd.pdf', () => scanDoc({ fontOpts: { toUnicode: 'fffd' } }))
fix('testo', 'txt-04-lingua-sbagliata.pdf', () => scanDoc({ blocks: PSEUDO }))

// Ogni lettera separata da spazio: il Tz si adatta, la geometria resta esatta.
fix('testo', 'txt-05-caratteri-isolati.pdf', () =>
  scanDoc({
    mapText: (lines) => lines.map((l) => ({ ...l, text: l.text.split('').join(' ') }))
  }))

// Tr non impostato a 3: il testo fantasma si vede sopra l'immagine.
fix('testo', 'txt-06-testo-visibile.pdf', () => scanDoc({ renderMode: 0, fillGray: 0.55 }))

// OCR eseguito due volte sullo stesso file: layer duplicato.
fix('testo', 'txt-07-doppio-layer.pdf', () => scanDoc({ repeat: 2 }))

// ─── immagine/ — qualita' del raster ─────────────────────────────────────────

fix('immagine', 'img-01-dpi-300.pdf', () => scanDoc({ dpi: 300 }))
fix('immagine', 'img-02-dpi-150.pdf', () => scanDoc({ dpi: 150 }))
fix('immagine', 'img-03-dpi-100.pdf', () => scanDoc({ dpi: 100 }))

fix('immagine', 'img-04-contrasto-basso.pdf', () =>
  scanDoc({
    paper: 188,
    ink: 142,
    encode: 'jpeg',
    jpegQuality: 45,
    postProcess: async (c) => (addNoise(c, rng(4004), 6), c)
  }))

fix('immagine', 'img-05-illuminazione.pdf', () =>
  scanDoc({
    postProcess: async (c) => {
      // Gradiente di luminosita' diagonale, come una pagina fotografata di lato.
      mapPixels(c, (x, y, v) => v - 95 * ((x / c.w) * 0.7 + (y / c.h) * 0.3))
      return c
    }
  }))

// Scansione inclinata di 3 gradi, con il layer inclinato allo stesso modo:
// qui il difetto e' la qualita' dell'immagine, non l'allineamento.
fix('immagine', 'img-06-inclinata-3gradi.pdf', () =>
  scanDoc({ rasterRot: 3, textTransform: rotateAbout(-3, CX, CY) }))

fix('immagine', 'img-07-sfocata.pdf', () =>
  scanDoc({ postProcess: async (c) => blurCanvas(c, 2.2) }))

fix('immagine', 'img-09-strisce.pdf', async () => {
  // Pagina composta da 12 strisce orizzontali, ciascuna un XObject distinto.
  const lines = layout(ATTO)[0]
  const rw = Math.round((PAGE.w * DPI) / 72)
  const rh = Math.round((PAGE.h * DPI) / 72)
  const c = createCanvas(rw, rh, 250)
  drawLines(c, lines, { sx: rw / PAGE.w, sy: rh / PAGE.h, ink: 25 })
  const doc = createDoc()
  const font = doc.font()
  const N = 12
  const images = []
  for (let i = 0; i < N; i++) {
    const y0 = Math.round((i * rh) / N)
    const y1 = Math.round(((i + 1) * rh) / N)
    const band = { w: rw, h: y1 - y0, data: c.data.subarray(y0 * rw, y1 * rw) }
    const enc = encodeFlate(band)
    const ref = doc.addImage({ w: band.w, h: band.h, bytes: enc.bytes, dict: enc.dict })
    const topPt = (y0 / rh) * PAGE.h
    const hPt = ((y1 - y0) / rh) * PAGE.h
    images.push({ ref, cm: fillCm(0, PAGE.h - topPt - hPt, PAGE.w, hPt) })
  }
  doc.addPage({ images, text: { lines, fontRef: font } })
  return doc.toBuffer()
})

fix('immagine', 'img-10-ctm-ruotato.pdf', async () => {
  // Raster orizzontale ruotato di 90 gradi dalla cm; layer ruotato con lui.
  const land = { w: PAGE.h, h: PAGE.w }
  const lines = layout(ATTO, { page: land })[0]
  const rw = Math.round((land.w * DPI) / 72)
  const rh = Math.round((land.h * DPI) / 72)
  const c = createCanvas(rw, rh, 250)
  drawLines(c, lines, { sx: rw / land.w, sy: rh / land.h, ink: 25 })
  const enc = encodeFlate(c)
  const doc = createDoc()
  const font = doc.font()
  const ref = doc.addImage({ w: rw, h: rh, bytes: enc.bytes, dict: enc.dict })
  // (u,v) unitario -> pagina ritratto, rotazione di 90 gradi antioraria
  const cm = [0, PAGE.h, -PAGE.w, 0, PAGE.w, 0]
  // Il testo e' impaginato sul foglio orizzontale: prima lo si riporta in quello
  // spazio (la baseline e' calcolata su PAGE.h), poi lo si ruota come l'immagine.
  const T = mul(translate(0, -(PAGE.h - land.h)), [0, 1, -1, 0, PAGE.w, 0])
  doc.addPage({ images: [{ ref, cm }], text: { lines, fontRef: font, transform: T } })
  return doc.toBuffer()
})

fix('immagine', 'img-11-smask.pdf', async () => {
  const lines = layout(ATTO)[0]
  const rw = Math.round((PAGE.w * DPI) / 72)
  const rh = Math.round((PAGE.h * DPI) / 72)
  const c = createCanvas(rw, rh, 250)
  drawLines(c, lines, { sx: rw / PAGE.w, sy: rh / PAGE.h, ink: 25 })
  // Canale alfa: opaco al centro, sfumato ai bordi (bordo di scansione).
  const a = createCanvas(rw, rh, 255)
  mapPixels(a, (x, y) => {
    const m = Math.min(x, y, rw - 1 - x, rh - 1 - y) / (0.03 * rh)
    return 255 * Math.min(1, Math.max(0, m))
  })
  const doc = createDoc()
  const font = doc.font()
  const encA = encodeFlate(a)
  const smask = doc.addImage({ w: rw, h: rh, bytes: encA.bytes, dict: encA.dict })
  const enc = encodeFlate(c)
  const ref = doc.addImage({
    w: rw, h: rh, bytes: enc.bytes, dict: enc.dict, extra: `/SMask ${smask} 0 R`
  })
  doc.addPage({ images: [{ ref, cm: fillCm(0, 0, PAGE.w, PAGE.h) }], text: { lines, fontRef: font } })
  return doc.toBuffer()
})

fix('immagine', 'img-12-indexed.pdf', () => scanDoc({ encode: 'indexed' }))

fix('immagine', 'img-13-xobject-condiviso.pdf', async () => {
  // Stessa immagine su due pagine: un solo XObject, due riferimenti.
  const lines = layout(ATTO)[0]
  const rw = Math.round((PAGE.w * DPI) / 72)
  const rh = Math.round((PAGE.h * DPI) / 72)
  const c = createCanvas(rw, rh, 250)
  drawLines(c, lines, { sx: rw / PAGE.w, sy: rh / PAGE.h, ink: 25 })
  const enc = encodeFlate(c)
  const doc = createDoc()
  const font = doc.font()
  const ref = doc.addImage({ w: rw, h: rh, bytes: enc.bytes, dict: enc.dict })
  for (let i = 0; i < 2; i++) {
    doc.addPage({ images: [{ ref, cm: fillCm(0, 0, PAGE.w, PAGE.h) }], text: { lines, fontRef: font } })
  }
  return doc.toBuffer()
})

fix('immagine', 'img-08-mrc.pdf', async () => {
  // Schema MRC minimo: fondo a bassa risoluzione + maschera 1 bit ad alta
  // risoluzione che porta il testo. Due XObject sovrapposti sulla stessa area.
  const lines = layout(ATTO)[0]
  const rw = Math.round((PAGE.w * DPI) / 72)
  const rh = Math.round((PAGE.h * DPI) / 72)
  const fg = createCanvas(rw, rh, 255)
  drawLines(fg, lines, { sx: rw / PAGE.w, sy: rh / PAGE.h, ink: 0 })
  const bw = Math.round((PAGE.w * 50) / 72)
  const bh = Math.round((PAGE.h * 50) / 72)
  const bg = createCanvas(bw, bh, 244)
  mapPixels(bg, (x, y, v) => v - 14 * (y / bh))
  addNoise(bg, rng(8008), 5)
  const doc = createDoc()
  const font = doc.font()
  const encBg = await encodeJpeg(bg, 50)
  const bgRef = doc.addImage({ w: bw, h: bh, bytes: encBg.bytes, dict: encBg.dict })
  const encFg = encodeImageMask(fg)
  const fgRef = doc.addImage({ w: rw, h: rh, bytes: encFg.bytes, dict: encFg.dict })
  doc.addPage({
    images: [
      { ref: bgRef, cm: fillCm(0, 0, PAGE.w, PAGE.h) },
      { ref: fgRef, cm: fillCm(0, 0, PAGE.w, PAGE.h), imageMaskGray: 0.08 }
    ],
    text: { lines, fontRef: font }
  })
  return doc.toBuffer()
})

fix('immagine', 'img-14-g4-grande.pdf', async () => {
  // CCITT G4 su una scansione bilivello rumorosa: il rumore fa saltare la
  // compressione a fax e produce lo stream grande che serve al test.
  // Larghezza e altezza multiple di 16 (vincolo del singolo tile, vedi raster.mjs).
  const rw = 1664
  const rh = 2352
  const lines = layout(ATTO)[0]
  const c = createCanvas(rw, rh, 235)
  drawLines(c, lines, { sx: rw / PAGE.w, sy: rh / PAGE.h, ink: 20 })
  addNoise(c, rng(1414), 95)
  const g4 = await encodeCcittG4(c, 160)
  const doc = createDoc()
  const font = doc.font()
  const ref = doc.addImage({
    w: rw,
    h: rh,
    bytes: g4.bytes,
    dict:
      `/Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ${rw} /Rows ${rh} ` +
      // Polarità verificata per misura sul PDF prodotto: con questa mappatura la
      // pagina renderizza con luma media ~225 (carta bianca). Quella opposta dava
      // 32 e l'89% di pixel scuri, cioè l'immagine invertita.
      `/BlackIs1 ${g4.photometric === 1 ? 'true' : 'false'} >> ` +
      `/ColorSpace /DeviceGray /BitsPerComponent 1`
  })
  doc.addPage({ images: [{ ref, cm: fillCm(0, 0, PAGE.w, PAGE.h) }], text: { lines, fontRef: font } })
  return doc.toBuffer()
})

// ─── noti-non-coperti/ — limiti dichiarati dello strumento ───────────────────

/**
 * Documento con le cifre gia' sbagliate NEI PIXEL (bug JBIG2 Xerox).
 * La contraddizione e' interna al documento: le lettere dicono quarantottomila,
 * le cifre dicono 46.000,00. Layer e pixel concordano: entrambi sbagliati.
 */
const ESTRATTO = [
  { k: 'h', t: 'ESTRATTO CONTO LAVORI - CANTIERE VIA DELLE FIXTURE 12' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "Importo complessivo pattuito, in lettere: quarantottomila/00 euro. Importo riportato in " +
      "cifre nel prospetto che segue, come restituito dallo scanner dell'ufficio."
  },
  { k: 'b' },
  { k: 'p', t: 'Acconto versato in data 14 marzo 2021 . . . . . . euro 16.000,00' },
  { k: 'p', t: 'Secondo acconto del 30 giugno 2021 . . . . . . . euro 16.000,00' },
  { k: 'p', t: 'Saldo del 12 dicembre 2021 . . . . . . . . . . . euro 16.000,00' },
  { k: 'p', t: 'Totale versato . . . . . . . . . . . . . . . . . euro 46.000,00' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "Il totale stampato non coincide con la somma degli addendi ne' con l'importo in lettere: " +
      "la cifra e' stata sostituita dalla compressione a pattern dello scanner."
  },
  { k: 'b' },
  { k: 'r', t: 'Cittafinta, 5 maggio 2022' }
]

fix('noti-non-coperti', 'nc-01-xerox-jbig2.pdf', async () => {
  // Il raster deve contenere GLIFI VERI, non barrette: si renderizza un PDF
  // digitale e se ne riusano le righe misurate da MuPDF per il layer.
  const digital = digitalDoc(ESTRATTO)
  const lines = await extractLines(digital, 0)
  const canvas = await renderPageToCanvas(digital, 0, DPI)
  addNoise(canvas, rng(9001), 7)
  const enc = await encodeJpeg(canvas, 45)
  const doc = createDoc()
  const font = doc.font()
  const ref = doc.addImage({ w: canvas.w, h: canvas.h, bytes: enc.bytes, dict: enc.dict })
  doc.addPage({ images: [{ ref, cm: fillCm(0, 0, PAGE.w, PAGE.h) }], text: { lines, fontRef: font } })
  return doc.toBuffer()
})

// Layer perfettamente allineato che ha pero' saltato un blocco di testo:
// il verdetto 'aligned' e' corretto, ma quei nomi non verranno mai redatti.
fix('noti-non-coperti', 'nc-02-layer-incompleto.pdf', () =>
  scanDoc({ mapText: (lines) => lines.filter((_, i) => i < 12 || i > 19) }))

// ─── roundtrip/ — OCR reale nel giro ─────────────────────────────────────────

function findTessdata() {
  const candidati = [
    process.env.ANONIMATOR_TESSDATA,
    join(homedir(), 'Library', 'Application Support', 'anonimator', 'tessdata', 'ita.traineddata'),
    join(ROOT, '..', '..', 'resources', 'tessdata', 'ita.traineddata'),
    '/usr/share/tesseract-ocr/5/tessdata/ita.traineddata',
    '/usr/share/tesseract-ocr/4.00/tessdata/ita.traineddata'
  ].filter(Boolean)
  for (const p of candidati) {
    try {
      if (existsSync(p) && statSync(p).size > 1_000_000) return p
    } catch { /* ignora */ }
  }
  return null
}

/** Converte le parole restituite da Tesseract nel modello di riga del corpus. */
function wordsToLines(data, scale) {
  const words = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node.text !== undefined && node.bbox && !node.words && !node.lines && !node.paragraphs) {
      words.push(node)
      return
    }
    for (const k of ['blocks', 'paragraphs', 'lines', 'words']) if (node[k]) visit(node[k])
  }
  visit(data.blocks || data)
  if (!words.length && data.words) visit(data.words)

  return words
    .filter((w) => w.text && w.text.trim() && (w.confidence === undefined || w.confidence > 30))
    .map((w) => {
      const b = w.bbox
      const baselinePx =
        w.baseline && w.baseline.has_baseline ? (w.baseline.y0 + w.baseline.y1) / 2 : b.y1
      const h = ((b.y1 - b.y0) / scale) * 0.55
      return {
        x: b.x0 / scale,
        top: baselinePx / scale - h,
        w: (b.x1 - b.x0) / scale,
        h,
        text: w.text.trim(),
        fontSize: h / 0.5
      }
    })
    .filter((l) => l.w > 0.5 && l.h > 0.5)
}

const ROUNDTRIP_DPI = 200

async function buildRoundtrip(outDir, log, required = false) {
  const tessdata = findTessdata()
  if (!tessdata) {
    if (required) throw new Error('ita.traineddata non trovato: roundtrip obbligatorio')
    log('  ita.traineddata non trovato: gruppo roundtrip/ SALTATO (vedi roundtrip/README.md)')
    return []
  }

  // 1. pagina di testo digitale -> raster 200 DPI con JPEG e lieve rumore
  const digital = digitalDoc(ATTO)
  const canvas = await renderPageToCanvas(digital, 0, ROUNDTRIP_DPI)
  addNoise(canvas, rng(7007), 9)
  const enc = await encodeJpeg(canvas, 55)

  // 2. OCR con il tesseract.js del progetto — UN SOLO worker per tutte le pagine
  const { createWorker } = await import('tesseract.js')
  const { createRequire } = await import('node:module')
  const _require = createRequire(import.meta.url)
  const workerPath = _require.resolve('tesseract.js/src/worker-script/node/index.js')
  const langData = { code: 'ita', data: await readFile(tessdata) }
  const worker = await createWorker([langData], 1, {
    workerPath,
    cacheMethod: 'none',
    gzip: false
  })

  let ocrLines
  const tmp = join(ROOT, 'roundtrip', '.ocr-input.jpg')
  try {
    await writeFile(tmp, enc.bytes)
    const res = await worker.recognize(tmp)
    ocrLines = wordsToLines(res.data, ROUNDTRIP_DPI / 72)
    log(`  OCR reale: ${ocrLines.length} parole riconosciute`)
  } finally {
    await worker.terminate()
    await import('node:fs/promises').then((fs) => fs.unlink(tmp).catch(() => {}))
  }
  if (ocrLines.length < 50) throw new Error(`OCR ha prodotto solo ${ocrLines.length} parole`)

  const varianti = [
    ['rt-01-reale-allineato.pdf', IDENTITY],
    ['rt-02-reale-dy-8pt.pdf', translate(0, -8)],
    ['rt-03-reale-una-riga.pdf', translate(0, -STYLE.leading)],
    ['rt-04-reale-scala-1pct.pdf', scaleAbout(1.01, 1.01, 0, PAGE.h)]
  ]
  const written = []
  for (const [name, T] of varianti) {
    const doc = createDoc()
    const font = doc.font()
    const ref = doc.addImage({ w: canvas.w, h: canvas.h, bytes: enc.bytes, dict: enc.dict })
    doc.addPage({
      images: [{ ref, cm: fillCm(0, 0, PAGE.w, PAGE.h) }],
      text: { lines: ocrLines, fontRef: font, transform: T }
    })
    const buf = doc.toBuffer()
    await writeFile(join(outDir, name), buf)
    written.push([name, buf.length])
  }
  return written
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const onlyIdx = args.indexOf('--only')
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
  const wantRoundtrip = args.includes('--roundtrip')
  const requireRoundtrip = args.includes('--require-roundtrip')
  const log = (s) => process.stdout.write(s + '\n')

  const dirs = ['negativi', 'geometrici', 'testo', 'immagine', 'roundtrip', 'noti-non-coperti']
  for (const d of dirs) await mkdir(join(ROOT, d), { recursive: true })

  let total = 0
  let count = 0
  let lastDir = ''
  for (const f of FIXTURES) {
    if (only && !f.name.includes(only)) continue
    if (f.dir !== lastDir) { log(`\n${f.dir}/`); lastDir = f.dir }
    const buf = await f.build()
    await writeFile(join(ROOT, f.dir, f.name), buf)
    log(`  ${f.name.padEnd(34)} ${String(buf.length).padStart(8)} byte`)
    total += buf.length
    count++
  }

  if (wantRoundtrip) {
    log('\nroundtrip/  (OCR reale, richiede ita.traineddata)')
    const written = await buildRoundtrip(join(ROOT, 'roundtrip'), log, requireRoundtrip)
    if (requireRoundtrip && written.length === 0) throw new Error('nessuna fixture roundtrip generata')
    for (const [n, s] of written) {
      log(`  ${n.padEnd(34)} ${String(s).padStart(8)} byte`)
      total += s
      count++
    }
  } else {
    log('\nroundtrip/  saltato (usare --roundtrip; i file sono gia' + "'" + ' versionati)')
  }

  log(`\n${count} file, ${(total / 1024).toFixed(1)} KB in totale`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
