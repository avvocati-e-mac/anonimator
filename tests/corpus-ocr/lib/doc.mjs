// Assemblaggio del documento: pagine, XObject immagine, risorse, albero pagine.

import { Pdf } from './pdf.mjs'
import { addGlyphlessFont, addHelvetica, textLayerOps, textBlockOps, visibleTextOps } from './text.mjs'
import { PAGE } from './layout.mjs'
import { fillRect, fillRotRect } from './raster.mjs'

const fmt = (n) => (Math.abs(n) < 1e-9 ? '0' : Number(n.toFixed(4)).toString())

/**
 * Disegna le righe di testo come barrette sul raster.
 * `sx`/`sy` convertono punti in pixel; `rotDeg` inclina l'intera pagina
 * (scansione storta) attorno al centro del raster.
 */
export function drawLines(canvas, lines, opts = {}) {
  const sx = opts.sx
  const sy = opts.sy === undefined ? opts.sx : opts.sy
  const ink = opts.ink === undefined ? 25 : opts.ink
  const rot = opts.rotDeg || 0
  const ox = opts.ox === undefined ? canvas.w / 2 : opts.ox
  const oy = opts.oy === undefined ? canvas.h / 2 : opts.oy
  for (const ln of lines) {
    if (!ln.text || !ln.text.length) continue
    const cw = ln.w / ln.text.length
    const y = ln.top * sy
    const h = ln.h * sy
    // Una barretta per PAROLA, non per riga: senza gli spazi il raster e'
    // uniforme lungo la riga e uno scostamento orizzontale diventa invisibile
    // (era il caso di geo-03). Con le parole separate la misura in x ha senso.
    for (const [i, j] of wordSpans(ln.text)) {
      const x = (ln.x + i * cw) * sx
      const w = (j - i) * cw * sx
      if (rot) fillRotRect(canvas, x, y, w, h, ink, rot, ox, oy)
      else fillRect(canvas, x, y, w, h, ink)
    }
  }
}

/** Indici [inizio, fine) delle parole in una riga. */
function wordSpans(text) {
  const spans = []
  let i = 0
  while (i < text.length) {
    if (text[i] === ' ') { i++; continue }
    let j = i
    while (j < text.length && text[j] !== ' ') j++
    spans.push([i, j])
    i = j
  }
  return spans
}

/** Righello orizzontale (tabelle, intestazioni). */
export function drawRule(canvas, xPt, yPt, wPt, opts) {
  fillRect(canvas, xPt * opts.sx, yPt * opts.sy, wPt * opts.sx, Math.max(1, opts.thickness || 2), opts.ink === undefined ? 25 : opts.ink)
}

export function createDoc() {
  const pdf = new Pdf()
  const pagesRef = pdf.reserve()
  const catalogRef = pdf.add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`)
  const pageRefs = []
  const fonts = {}

  const doc = {
    pdf,

    /** @param {{w:number,h:number,bytes:Buffer,dict:string,extra?:string}} img */
    addImage(img) {
      return pdf.addStream(
        `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ${img.dict}` +
          (img.extra ? ' ' + img.extra : ''),
        img.bytes
      )
    },

    /** Font glyphless condiviso (uno per variante di ToUnicode/BaseFont). */
    font(opts = {}) {
      const key = `${opts.baseFont || ''}|${opts.toUnicode === undefined ? 'identity' : opts.toUnicode}`
      if (!fonts[key]) fonts[key] = addGlyphlessFont(pdf, opts)
      return fonts[key]
    },

    helvetica() {
      if (!fonts.__helv) fonts.__helv = addHelvetica(pdf)
      return fonts.__helv
    },

    /**
     * @param {{
     *   size?: {w:number,h:number},
     *   mediaBox?: number[], cropBox?: number[], rotate?: number, userUnit?: number,
     *   images?: {ref:number, cm:number[]}[],
     *   preOps?: string, postOps?: string,
     *   text?: {lines:Array, fontRef:number, transform?:number[], renderMode?:number,
     *           fillGray?:number, mode?:'lines'|'block', repeat?:number,
     *           extraCharSpacing?:number, blockStart?:number[]},
     *   visible?: {lines:Array}
     * }} p
     */
    addPage(p) {
      const size = p.size || PAGE
      const mb = p.mediaBox || [0, 0, size.w, size.h]
      const pageH = mb[3] // le coordinate del testo restano nello spazio della MediaBox
      const ops = []
      const xobjs = []

      for (const im of p.images || []) {
        const name = `Im${xobjs.length}`
        xobjs.push(`/${name} ${im.ref} 0 R`)
        ops.push('q')
        ops.push(`${im.cm.map(fmt).join(' ')} cm`)
        if (im.imageMaskGray !== undefined) ops.push(`${im.imageMaskGray} g`)
        ops.push(`/${name} Do`)
        ops.push('Q')
      }

      if (p.preOps) ops.push(p.preOps)

      const fontRes = []
      if (p.visible) {
        fontRes.push(`/FH ${doc.helvetica()} 0 R`)
        ops.push(visibleTextOps(p.visible.lines, { pageH, fontRes: 'FH' }))
      }
      if (p.text) {
        fontRes.push(`/F1 ${p.text.fontRef} 0 R`)
        const times = p.text.repeat || 1
        for (let i = 0; i < times; i++) {
          ops.push(
            p.text.mode === 'block'
              ? textBlockOps(p.text.lines, {
                  pageH,
                  fontRes: 'F1',
                  renderMode: p.text.renderMode,
                  start: p.text.blockStart
                })
              : textLayerOps(p.text.lines, {
                  pageH,
                  fontRes: 'F1',
                  renderMode: p.text.renderMode,
                  transform: p.text.transform,
                  fillGray: p.text.fillGray,
                  extraCharSpacing: p.text.extraCharSpacing
                })
          )
        }
      }
      if (p.postOps) ops.push(p.postOps)

      const contentRef = pdf.addStream('', ops.join('\n'), { compress: true })
      const res =
        `/Resources << ${xobjs.length ? `/XObject << ${xobjs.join(' ')} >> ` : ''}` +
        `${fontRes.length ? `/Font << ${fontRes.join(' ')} >> ` : ''}` +
        `/ProcSet [/PDF /Text /ImageB /ImageC /ImageI] >>`

      const ref = pdf.add(
        `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [${mb.map(fmt).join(' ')}] ` +
          (p.cropBox ? `/CropBox [${p.cropBox.map(fmt).join(' ')}] ` : '') +
          (p.rotate ? `/Rotate ${p.rotate} ` : '') +
          (p.userUnit ? `/UserUnit ${p.userUnit} ` : '') +
          `${res} /Contents ${contentRef} 0 R >>`
      )
      pageRefs.push(ref)
      return ref
    },

    toBuffer() {
      pdf.set(
        pagesRef,
        `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs
          .map((r) => `${r} 0 R`)
          .join(' ')}] >>`
      )
      return pdf.toBuffer(catalogRef)
    }
  }

  return doc
}

/** cm che mappa l'immagine sull'intera area indicata (origine in basso a sinistra). */
export function fillCm(x, y, w, h) {
  return [w, 0, 0, h, x, y]
}
