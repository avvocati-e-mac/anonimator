// Costruzione del raster sintetico.
//
// Il raster è DISEGNATO, non fotografato: ogni riga di testo è una barretta nera
// di spessore pari alla x-height. Così la ground truth è esatta al punto, i file
// restano di poche decine di KB e la generazione è riproducibile.

import sharp from 'sharp'
import { deflateSync } from 'node:zlib'

/** PRNG deterministico (mulberry32): stesso seme => stesso rumore, sempre. */
export function rng(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tela in scala di grigi, 8 bit per pixel, origine in alto a sinistra. */
export function createCanvas(w, h, fill = 250) {
  return { w, h, data: new Uint8Array(w * h).fill(fill) }
}

export function fillRect(c, x, y, w, h, v) {
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(c.w, Math.round(x + w))
  const y1 = Math.min(c.h, Math.round(y + h))
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * c.w
    for (let xx = x0; xx < x1; xx++) c.data[row + xx] = v
  }
}

/**
 * Rettangolo ruotato di `deg` attorno a (ox, oy). Test di appartenenza sul centro
 * del pixel: bordi netti, nessun antialiasing (lo aggiunge chi lo vuole, via blur).
 */
export function fillRotRect(c, x, y, w, h, v, deg, ox, oy) {
  const rad = (deg * Math.PI) / 180
  const cs = Math.cos(rad)
  const sn = Math.sin(rad)
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h]
  ].map(([px, py]) => {
    const dx = px - ox
    const dy = py - oy
    return [ox + dx * cs - dy * sn, oy + dx * sn + dy * cs]
  })
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)))
  const bx1 = Math.min(c.w, Math.ceil(Math.max(...xs)))
  const by0 = Math.max(0, Math.floor(Math.min(...ys)))
  const by1 = Math.min(c.h, Math.ceil(Math.max(...ys)))
  for (let yy = by0; yy < by1; yy++) {
    for (let xx = bx0; xx < bx1; xx++) {
      // Anti-ruota il centro del pixel e verifica nel sistema non ruotato
      const dx = xx + 0.5 - ox
      const dy = yy + 0.5 - oy
      const ux = ox + dx * cs + dy * sn
      const uy = oy - dx * sn + dy * cs
      if (ux >= x && ux < x + w && uy >= y && uy < y + h) c.data[yy * c.w + xx] = v
    }
  }
}

/** Cerchio vuoto (timbri). */
export function strokeCircle(c, cx, cy, r, thickness, v) {
  const r0 = r - thickness / 2
  const r1 = r + thickness / 2
  const x0 = Math.max(0, Math.floor(cx - r1))
  const x1 = Math.min(c.w, Math.ceil(cx + r1))
  const y0 = Math.max(0, Math.floor(cy - r1))
  const y1 = Math.min(c.h, Math.ceil(cy + r1))
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
      if (d >= r0 && d <= r1) c.data[yy * c.w + xx] = v
    }
  }
}

/** Polilinea spessa (firme, sottolineature a mano). */
export function strokePath(c, pts, thickness, v) {
  for (let i = 1; i < pts.length; i++) {
    const [xa, ya] = pts[i - 1]
    const [xb, yb] = pts[i]
    const len = Math.hypot(xb - xa, yb - ya)
    const steps = Math.max(1, Math.ceil(len))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const px = xa + (xb - xa) * t
      const py = ya + (yb - ya) * t
      fillRect(c, px - thickness / 2, py - thickness / 2, thickness, thickness, v)
    }
  }
}

/** Applica una funzione (x, y, valore) => nuovo valore su tutti i pixel. */
export function mapPixels(c, fn) {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const i = y * c.w + x
      c.data[i] = Math.max(0, Math.min(255, Math.round(fn(x, y, c.data[i]))))
    }
  }
}

/** Rumore gaussiano approssimato (somma di due uniformi): grana di scansione. */
export function addNoise(c, rand, amplitude) {
  for (let i = 0; i < c.data.length; i++) {
    const n = (rand() + rand() - 1) * amplitude
    c.data[i] = Math.max(0, Math.min(255, Math.round(c.data[i] + n)))
  }
}

export function toRawGray(c) {
  return Buffer.from(c.data.buffer, c.data.byteOffset, c.data.length)
}

// ─── Codifiche per gli XObject immagine ──────────────────────────────────────

/**
 * FlateDecode con predittore PNG "Up": righe identiche si annullano,
 * una pagina di barrette scende a pochi KB.
 */
export function encodeFlate(c) {
  const rows = Buffer.alloc((c.w + 1) * c.h)
  let prev = new Uint8Array(c.w)
  for (let y = 0; y < c.h; y++) {
    const off = y * (c.w + 1)
    rows[off] = 2 // filtro Up
    for (let x = 0; x < c.w; x++) {
      rows[off + 1 + x] = (c.data[y * c.w + x] - prev[x]) & 0xff
    }
    prev = c.data.subarray(y * c.w, (y + 1) * c.w)
  }
  const bytes = deflateSync(rows, { level: 9 })
  return {
    bytes,
    dict:
      `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 ` +
      `/BitsPerComponent 8 /Columns ${c.w} >> ` +
      `/ColorSpace /DeviceGray /BitsPerComponent 8`
  }
}

/**
 * JPEG baseline in scala di grigi.
 *
 * Due vincoli che sharp non rispetta da solo:
 *  - `toColourspace('b-w')`, altrimenti mozjpeg promuove l'immagine a 3 canali
 *    e il PDF, che dichiara /DeviceGray, mostra spazzatura;
 *  - `progressive: false`, perche' DCTDecode nel PDF vuole JPEG sequenziale
 *    (l'opzione `mozjpeg` attiva optimiseScans, e quindi il progressivo).
 */
export async function encodeJpeg(c, quality = 40) {
  const bytes = await sharp(toRawGray(c), { raw: { width: c.w, height: c.h, channels: 1 } })
    .toColourspace('b-w')
    .jpeg({
      quality,
      progressive: false,
      optimiseCoding: true,
      trellisQuantisation: true,
      overshootDeringing: true,
      quantisationTable: 3,
      chromaSubsampling: '4:4:4'
    })
    .toBuffer()
  return { bytes, dict: '/Filter /DCTDecode /ColorSpace /DeviceGray /BitsPerComponent 8' }
}

/**
 * Riporta l'uscita di sharp in una tela a un canale.
 * `toColourspace('b-w')` non e' facoltativo: senza, libvips promuove a sRGB e
 * restituisce 3 byte per pixel, che letti come grigi danno spazzatura.
 */
async function toCanvas(pipeline, w, h) {
  const out = await pipeline.toColourspace('b-w').raw({ depth: 'uchar' }).toBuffer()
  if (out.length !== w * h) {
    throw new Error(`atteso 1 canale (${w * h} byte), ricevuti ${out.length}`)
  }
  return { w, h, data: new Uint8Array(out) }
}

/** Sfoca con libvips: serve dove il difetto e' proprio la messa a fuoco. */
export async function blurCanvas(c, sigma) {
  return toCanvas(
    sharp(toRawGray(c), { raw: { width: c.w, height: c.h, channels: 1 } }).blur(sigma),
    c.w,
    c.h
  )
}

/** Ridimensiona (usato per simulare DPI nativi bassi risalendo a dimensione piena). */
export async function resizeCanvas(c, w, h, kernel = 'lanczos3') {
  return toCanvas(
    sharp(toRawGray(c), { raw: { width: c.w, height: c.h, channels: 1 } })
      .resize(w, h, { kernel, fit: 'fill' }),
    w,
    h
  )
}

/**
 * CCITT G4 come UNICO codestream.
 *
 * libvips in modalita' "strip" spezza il G4 in strip da 256 righe, e gli strip
 * non sono concatenabili (ognuno riparte da una riga di riferimento bianca):
 * PDF vuole invece un flusso continuo di /Rows righe. Si usa quindi la modalita'
 * "tile" con un solo tile grande quanto l'immagine. Per non avere padding,
 * larghezza e altezza devono essere multipli di 16.
 */
export async function encodeCcittG4(c, threshold = 160) {
  if (c.w % 16 !== 0 || c.h % 16 !== 0) {
    throw new Error(`CCITT G4: dimensioni ${c.w}x${c.h} non multiple di 16`)
  }
  const tiff = await sharp(toRawGray(c), { raw: { width: c.w, height: c.h, channels: 1 } })
    .threshold(threshold)
    .toColourspace('b-w')
    .tiff({ compression: 'ccittfax4', bitdepth: 1, tile: true, tileWidth: c.w, tileHeight: c.h })
    .toBuffer()
  const tags = readTiffTags(tiff)
  const offsets = tags[324] || tags[273]
  const counts = tags[325] || tags[279]
  if (!offsets || offsets.length !== 1) {
    throw new Error(`CCITT G4: attesi 1 tile, trovati ${offsets ? offsets.length : 0}`)
  }
  return {
    bytes: tiff.subarray(offsets[0], offsets[0] + counts[0]),
    /** 0 = MinIsWhite, 1 = MinIsBlack. libvips scrive 1, che corrisponde a /BlackIs1 false. */
    photometric: (tags[262] || [1])[0]
  }
}

/** Parser TIFF ridotto all'osso: legge la prima IFD e restituisce i tag come array. */
export function readTiffTags(buf) {
  const le = buf.readUInt16BE(0) === 0x4949
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
  const ifd = u32(4)
  const count = u16(ifd)
  const tags = {}
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12
    const type = u16(e + 2)
    const n = u32(e + 4)
    const size = { 1: 1, 2: 1, 3: 2, 4: 4 }[type] || 4
    const base = n * size <= 4 ? e + 8 : u32(e + 8)
    const vals = []
    for (let k = 0; k < n; k++) {
      const o = base + k * size
      vals.push(size === 2 ? u16(o) : size === 4 ? u32(o) : buf[o])
    }
    tags[u16(e)] = vals
  }
  return tags
}

/** Immagine indicizzata a 4 bit: valore grigio => indice in una palette di 16 toni. */
export function encodeIndexed4(c, palette) {
  const bytesPerRow = Math.ceil(c.w / 2)
  const out = Buffer.alloc(bytesPerRow * c.h)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      let best = 0
      let bestD = 1e9
      const v = c.data[y * c.w + x]
      for (let i = 0; i < palette.length; i++) {
        const d = Math.abs(palette[i] - v)
        if (d < bestD) { bestD = d; best = i }
      }
      const o = y * bytesPerRow + (x >> 1)
      out[o] |= x % 2 === 0 ? best << 4 : best
    }
  }
  const hex = Buffer.from(palette).toString('hex').toUpperCase()
  return {
    bytes: deflateSync(out, { level: 9 }),
    dict:
      `/Filter /FlateDecode /ColorSpace [/Indexed /DeviceGray ${palette.length - 1} <${hex}>] ` +
      `/BitsPerComponent 4`
  }
}

/** Maschera a 1 bit (/ImageMask): 1 = trasparente, 0 = inchiostro. */
export function encodeImageMask(c, threshold = 160) {
  const bytesPerRow = Math.ceil(c.w / 8)
  const out = Buffer.alloc(bytesPerRow * c.h, 0xff)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (c.data[y * c.w + x] < threshold) {
        out[y * bytesPerRow + (x >> 3)] &= ~(0x80 >> (x % 8))
      }
    }
  }
  return { bytes: deflateSync(out, { level: 9 }), dict: '/Filter /FlateDecode /ImageMask true' }
}
