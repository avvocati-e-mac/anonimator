// Il layer di testo invisibile.
//
// Struttura identica a quella dei veri "sandwich OCR": font Type0 / Identity-H
// con discendente CIDFontType2 senza programma di font (glyphless), larghezza
// unica /DW 500 e una /ToUnicode che e' l'unico ponte verso l'Unicode. Il testo
// e' posato in render mode 3 (invisibile) con una Tm esplicita per ogni riga.
//
// Le CID NON coincidono con i codici ASCII: cid = ascii - 0x1F. Cosi' un font
// privo di /ToUnicode produce davvero estrazione illeggibile, come accade con i
// subset senza mappa — altrimenti il caso txt-01 non simulerebbe nulla.

const CID_OFFSET = 0x1f

export function charToCid(ch) {
  const code = ch.charCodeAt(0)
  if (code < 0x20 || code > 0x7e) return 1 // spazio: fuori ASCII stampabile non serve
  return code - CID_OFFSET
}

export function textToCidHex(text) {
  let out = ''
  for (const ch of text) out += charToCid(ch).toString(16).padStart(4, '0').toUpperCase()
  return out
}

/**
 * Costruisce la CMap /ToUnicode.
 * @param {'identity'|'pua'|'fffd'} mode
 */
function toUnicodeCMap(mode) {
  const entries = []
  for (let code = 0x20; code <= 0x7e; code++) {
    const cid = code - CID_OFFSET
    let uni = code
    if (mode === 'pua') uni = 0xe000 + cid
    else if (mode === 'fffd' && 'aeiouAEIOU'.includes(String.fromCharCode(code))) uni = 0xfffd
    entries.push(
      `<${cid.toString(16).padStart(4, '0')}> <${uni.toString(16).padStart(4, '0')}>`
    )
  }
  // beginbfchar ammette al massimo 100 voci per blocco
  const chunks = []
  for (let i = 0; i < entries.length; i += 100) {
    const part = entries.slice(i, i + 100)
    chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`)
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`
}

/**
 * Aggiunge al PDF il font glyphless e ne restituisce il riferimento.
 * @param {{baseFont?: string, toUnicode?: 'identity'|'pua'|'fffd'|'none'}} opts
 */
export function addGlyphlessFont(pdf, opts = {}) {
  const baseFont = opts.baseFont || 'AAAAAA+SinteticoOCR'
  const mode = opts.toUnicode === undefined ? 'identity' : opts.toUnicode

  const descriptor = pdf.add(
    `<< /Type /FontDescriptor /FontName /${baseFont} /Flags 4 ` +
      `/FontBBox [0 -200 500 800] /ItalicAngle 0 /Ascent 800 /Descent -200 ` +
      `/CapHeight 700 /StemV 80 >>`
  )
  const cidFont = pdf.add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /DW 500 /CIDToGIDMap /Identity >>`
  )
  let toUni = ''
  if (mode !== 'none') {
    const ref = pdf.addStream('', toUnicodeCMap(mode), { compress: true })
    toUni = ` /ToUnicode ${ref} 0 R`
  }
  return pdf.add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-H ` +
      `/DescendantFonts [${cidFont} 0 R]${toUni} >>`
  )
}

/** Font base-14 visibile, per le pagine digitali native. */
export function addHelvetica(pdf) {
  return pdf.add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  )
}

// ─── Matrici affini (convenzione PDF: vettori riga, p' = p * M) ──────────────

export const IDENTITY = [1, 0, 0, 1, 0, 0]

export function mul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5]
  ]
}

export const translate = (dx, dy) => [1, 0, 0, 1, dx, dy]

export function scaleAbout(sx, sy, ox, oy) {
  return [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy]
}

export function rotateAbout(deg, ox, oy) {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, ox - ox * c + oy * s, oy - ox * s - oy * c]
}

/** Specchiatura orizzontale attorno a x = ox. */
export const mirrorX = (ox) => [-1, 0, 0, 1, 2 * ox, 0]

/** Specchiatura verticale attorno a y = oy. */
export const mirrorY = (oy) => [1, 0, 0, -1, 0, 2 * oy]

const fmt = (n) => (Math.abs(n) < 1e-9 ? '0' : Number(n.toFixed(4)).toString())

// ─── Generazione degli operatori ─────────────────────────────────────────────

/**
 * Operatori del layer invisibile: una Tm per riga, come fa un OCR reale.
 *
 * @param {Array} lines righe da layout()
 * @param {{
 *   pageH: number, fontRes?: string, renderMode?: number,
 *   transform?: number[], charWidthEm?: number, extraCharSpacing?: number
 * }} opts
 */
export function textLayerOps(lines, opts) {
  const pageH = opts.pageH
  const res = opts.fontRes || 'F1'
  const tr = opts.renderMode === undefined ? 3 : opts.renderMode
  const T = opts.transform || IDENTITY
  const emW = opts.charWidthEm === undefined ? 0.5 : opts.charWidthEm
  const out = ['BT', `${tr} Tr`]
  if (opts.fillGray !== undefined) out.push(`${opts.fillGray} g`)
  for (const ln of lines) {
    if (!ln.text) continue
    const size = ln.fontSize
    const natural = ln.text.length * emW * size
    const tz = natural > 0 ? (ln.w / natural) * 100 : 100
    // baseline = bordo inferiore della barretta, convertito in coordinate PDF
    const base = [1, 0, 0, 1, ln.x, pageH - (ln.top + ln.h)]
    const m = mul(base, T)
    out.push(`/${res} ${fmt(size)} Tf`)
    out.push(`${fmt(tz)} Tz`)
    out.push(`${m.map(fmt).join(' ')} Tm`)
    if (opts.extraCharSpacing) out.push(`${fmt(opts.extraCharSpacing)} Tc`)
    out.push(`<${textToCidHex(ln.text)}> Tj`)
  }
  out.push('ET')
  return out.join('\n')
}

/**
 * Variante "blocco unico": una sola Tm all'origine e avanzamento con T*.
 * Riproduce gli OCR che non emettono coordinate per riga.
 */
export function textBlockOps(lines, opts) {
  const res = opts.fontRes || 'F1'
  const leading = opts.leading || 14
  const size = opts.fontSize || 10
  const start = opts.start || [0, opts.pageH]
  const out = [
    'BT',
    `${opts.renderMode === undefined ? 3 : opts.renderMode} Tr`,
    `/${res} ${fmt(size)} Tf`,
    '100 Tz',
    `${fmt(leading)} TL`,
    `1 0 0 1 ${fmt(start[0])} ${fmt(start[1])} Tm`
  ]
  for (const ln of lines) {
    out.push('T*')
    if (ln.text) out.push(`<${textToCidHex(ln.text)}> Tj`)
  }
  out.push('ET')
  return out.join('\n')
}

/** Testo visibile con font base-14 (pagine digitali native). */
export function visibleTextOps(lines, opts) {
  const res = opts.fontRes || 'FH'
  const pageH = opts.pageH
  const out = ['BT', '0 Tr', '0 g']
  for (const ln of lines) {
    if (!ln.text) continue
    out.push(`/${res} ${fmt(ln.fontSize)} Tf`)
    out.push(`1 0 0 1 ${fmt(ln.x)} ${fmt(pageH - (ln.top + ln.h))} Tm`)
    out.push(`(${ln.text.replace(/[\\()]/g, (c) => '\\' + c)}) Tj`)
  }
  out.push('ET')
  return out.join('\n')
}
