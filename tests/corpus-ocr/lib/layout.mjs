// Impaginazione del testo sintetico.
//
// Tutto il corpus usa un font a passo fisso di 0,5 em (il glifo "vuoto" degli
// OCR: DW 500, nessuna /W). Con corpo 10 pt ogni carattere avanza esattamente
// 5 pt, quindi la larghezza di una riga e' nota al punto e la barretta del
// raster puo' coincidere con il testo invisibile senza approssimazioni.

/** A4 in punti tipografici. */
export const PAGE = { w: 595, h: 842 }

export const STYLE = {
  margin: 64,
  fontSize: 10,
  /** Spessore della barretta nel raster = x-height del carattere. */
  xHeight: 5,
  leading: 14,
  /** Avanzamento di un carattere: 0,5 em. */
  charW: 5,
  indent: 20
}

/**
 * Testo di riferimento del corpus.
 *
 * DATI INTERAMENTE SINTETICI E MANIFESTAMENTE FINTI.
 * Nomi convenzionali gia' in uso nel progetto (Mario Rossi, Giulia Bianchi),
 * toponimi inventati, dominio .invalid riservato dalla RFC 2606, codice fiscale
 * e IBAN di comodo. Nessun riferimento a persone reali.
 */
export const ATTO = [
  { k: 'h', t: 'TRIBUNALE ORDINARIO DI CITTAFINTA' },
  { k: 'h', t: 'SEZIONE PRIMA CIVILE' },
  { k: 'b' },
  { k: 'h', t: 'ATTO DI CITAZIONE' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "Il sig. Mario Rossi, nato a Cittafinta il 1 gennaio 1980, codice fiscale RSSMRA80A01H501U, " +
      "residente in Via delle Fixture 12, 00100 Cittafinta, elettivamente domiciliato presso lo " +
      "studio dell'avv. Giulia Bianchi del Foro di Cittafinta, che lo rappresenta e difende giusta " +
      "procura in calce al presente atto,"
  },
  { k: 'b' },
  { k: 'h', t: 'ESPONE QUANTO SEGUE' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "1. In data 14 marzo 2021 l'attore stipulava con la societa' Alfa S.r.l., partita IVA " +
      "12345678901, corrente in Via del Campione 3, un contratto di appalto avente ad oggetto la " +
      "ristrutturazione dell'immobile sito in Cittafinta, Via delle Fixture 12."
  },
  {
    k: 'p',
    t:
      "2. Il corrispettivo pattuito, pari a euro 48.000,00, veniva versato in tre rate sul conto " +
      "corrente IT60X0542811101000000123456 acceso presso la Banca Sintetica S.p.A."
  },
  {
    k: 'p',
    t:
      "3. I lavori venivano sospesi senza giustificato motivo e mai portati a termine, come " +
      "risulta dalla relazione tecnica del geom. Carlo Verdi depositata sub doc. 4."
  },
  {
    k: 'p',
    t:
      "4. Ogni tentativo di componimento bonario, anche a mezzo posta elettronica certificata " +
      "all'indirizzo alfa.srl@pec-esempio.invalid e telefonicamente al numero 06 12345678, " +
      "restava privo di riscontro."
  },
  {
    k: 'p',
    t:
      "5. La convenuta, benche' ritualmente diffidata con raccomandata del 2 febbraio 2022, non " +
      "ha inteso restituire le somme ricevute ne' completare le opere, cosi' costringendo " +
      "l'odierno attore a sostenere ulteriori spese per il completamento del cantiere."
  },
  {
    k: 'p',
    t:
      "6. Il danno patito, documentato dai preventivi in atti, ammonta a complessivi euro " +
      "21.500,00, somma corrispondente al maggior costo sopportato per affidare i lavori residui " +
      "all'impresa Beta S.p.A. di Vallesintetica."
  },
  { k: 'b' },
  { k: 'h', t: 'IN DIRITTO' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "7. La responsabilita' della convenuta discende dall'inadempimento delle obbligazioni " +
      "assunte con il contratto di appalto, non essendo stata fornita alcuna prova del fatto " +
      "impeditivo, estintivo o modificativo del diritto azionato."
  },
  {
    k: 'p',
    t:
      "8. Le somme richieste sono liquide ed esigibili e producono interessi dalla data della " +
      "costituzione in mora, coincidente con la ricezione della diffida sopra richiamata."
  },
  { k: 'b' },
  { k: 'h', t: 'P.Q.M.' },
  { k: 'b' },
  {
    k: 'p',
    t:
      "Voglia l'Ill.mo Tribunale adito, respinta ogni contraria istanza, accertare e dichiarare " +
      "l'inadempimento della convenuta e per l'effetto condannarla al pagamento della somma di " +
      "euro 48.000,00, oltre interessi e rivalutazione, con vittoria di spese e compensi di lite."
  },
  { k: 'b' },
  {
    k: 'p',
    t:
      "Si producono: 1) contratto di appalto del 14 marzo 2021; 2) quietanze di pagamento; " +
      "3) corrispondenza fra le parti; 4) relazione tecnica del geom. Carlo Verdi."
  },
  { k: 'b' },
  { k: 'r', t: 'Cittafinta, 5 maggio 2022' },
  { k: 'r', t: 'Avv. Giulia Bianchi' }
]

/** Frontespizio: poche parole, serve a verificare il caso "pagina quasi vuota". */
export const FRONTESPIZIO = [
  { k: 'b' },
  { k: 'b' },
  { k: 'b' },
  { k: 'h', t: 'ATTO DI CITAZIONE' },
  { k: 'b' },
  { k: 'h', t: 'Rossi contro Alfa S.r.l.' }
]

/** Spezza un paragrafo in righe da al massimo `maxChars` caratteri. */
export function wrap(text, maxChars, firstLineIndentChars = 0) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  let budget = maxChars - firstLineIndentChars
  for (const wd of words) {
    const next = cur ? cur + ' ' + wd : wd
    if (next.length > budget && cur) {
      lines.push(cur)
      cur = wd
      budget = maxChars
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/**
 * Trasforma i blocchi in righe posizionate.
 *
 * Ogni riga: { x, top, w, h, text } in punti, origine in alto a sinistra.
 * `top` e' il bordo superiore della barretta; la baseline del testo invisibile
 * coincide con `top + h`.
 */
export function layout(blocks, opts = {}) {
  const page = opts.page || PAGE
  const st = { ...STYLE, ...(opts.style || {}) }
  const columns = opts.columns || 1
  const gutter = opts.gutter || 24
  const colW = (page.w - 2 * st.margin - gutter * (columns - 1)) / columns
  const maxChars = Math.floor(colW / st.charW)
  const bottom = page.h - st.margin

  const pages = []
  let lines = []
  let col = 0
  let y = st.margin

  const colX = (i) => st.margin + i * (colW + gutter)

  const newColumn = () => {
    col++
    y = st.margin
    if (col >= columns) {
      pages.push(lines)
      lines = []
      col = 0
    }
  }

  for (const b of blocks) {
    if (b.k === 'pb') {
      // interruzione di pagina esplicita: serve a fissare il numero di pagine
      while (col < columns - 1) newColumn()
      pages.push(lines)
      lines = []
      col = 0
      y = st.margin
      continue
    }
    if (b.k === 'b') {
      y += st.leading
      if (y + st.leading > bottom) newColumn()
      continue
    }
    if (b.k === 'cells') {
      if (y + st.leading > bottom) newColumn()
      b.cells.forEach((t, ci) => {
        const spec = b.cols[ci]
        const txt = String(t).slice(0, spec.w)
        lines.push({
          x: colX(col) + spec.x * st.charW,
          top: y,
          w: txt.length * st.charW,
          h: st.xHeight,
          text: txt,
          fontSize: st.fontSize
        })
      })
      y += st.leading
      continue
    }
    const wrapped =
      b.k === 'p' ? wrap(b.t, maxChars, Math.round(st.indent / st.charW)) : [b.t.slice(0, maxChars)]
    wrapped.forEach((t, i) => {
      if (y + st.leading > bottom) newColumn()
      const w = t.length * st.charW
      let x
      if (b.k === 'h') x = colX(col) + (colW - w) / 2
      else if (b.k === 'r') x = colX(col) + colW - w
      else x = colX(col) + (i === 0 ? st.indent : 0)
      lines.push({ x, top: y, w, h: st.xHeight, text: t, fontSize: st.fontSize })
      y += st.leading
    })
  }
  pages.push(lines)
  return pages
}

/** Ripete l'atto su `n` pagine, con interruzioni esplicite. */
export function repeatBlocks(blocks, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    if (i > 0) out.push({ k: 'pb' })
    out.push(...blocks)
  }
  return out
}

/**
 * Come repeatBlocks, ma ogni pagina ha contenuto DIVERSO (scarta un numero
 * crescente di blocchi finali). Serve ai difetti che spostano il layer da una
 * pagina all'altra: con pagine identiche lo spostamento non è osservabile,
 * perché la pagina N+1 combacia comunque con il testo della pagina N.
 */
export function variedBlocks(blocks, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    if (i > 0) out.push({ k: 'pb' })
    // Si taglia dall'INIZIO: scartare blocchi finali lascerebbe identiche le
    // prime righe di ogni pagina, e un layer spostato di una pagina ricadrebbe
    // comunque sull'inchiostro giusto per quasi tutte le righe.
    const slice = blocks.slice(i * 3, Math.max(i * 3 + 6, blocks.length - i * 2))
    out.push(...slice)
  }
  return out
}

/** Tabella densa: righe di celle corte, per il caso neg-08. */
export function tableBlocks(rows = 18) {
  const cols = [
    { x: 0, w: 12 },
    { x: 14, w: 30 },
    { x: 46, w: 22 },
    { x: 70, w: 20 }
  ]
  const voci = [
    'Rata di acconto', 'Saldo lavori', 'Materiali', 'Manodopera', 'Oneri sicurezza',
    'Smaltimento', 'Noleggio ponteggi', 'Direzione lavori', 'Spese generali'
  ]
  const out = []
  for (let r = 0; r < rows; r++) {
    out.push({
      k: 'cells',
      cells: [
        String(r + 1),
        r === 0 ? 'Descrizione della voce' : voci[r % voci.length],
        r === 0 ? 'Imponibile' : (1200 + r * 137).toFixed(2).replace('.', ','),
        r === 0 ? 'IVA 22%' : ((1200 + r * 137) * 0.22).toFixed(2).replace('.', ',')
      ],
      cols
    })
  }
  return out
}
