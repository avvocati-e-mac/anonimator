// Ponte con MuPDF: serve dove il raster deve contenere GLIFI VERI e non barrette.
//
// Lo usano due gruppi soltanto:
//  - noti-non-coperti/nc-01, dove il difetto e' una cifra sbagliata nei pixel;
//  - roundtrip/, dove il raster deve poter essere dato in pasto a Tesseract.
// Tutto il resto del corpus disegna le barrette, che danno ground truth esatta.

/** Rende una pagina PDF in una tela in scala di grigi. */
export async function renderPageToCanvas(buf, pageIndex, dpi) {
  const mupdf = (await import('mupdf')).default
  const doc = new mupdf.PDFDocument(buf)
  const page = doc.loadPage(pageIndex)
  const scale = dpi / 72
  const px = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false)
  const w = px.getWidth()
  const h = px.getHeight()
  const src = px.getPixels()
  const stride = src.length / h
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = src[y * stride + x]
  }
  return { w, h, data }
}

/**
 * Righe di testo di una pagina, in coordinate di impaginazione (origine in alto
 * a sinistra, punti). `top + h` coincide con la baseline, come in layout().
 */
export async function extractLines(buf, pageIndex) {
  const mupdf = (await import('mupdf')).default
  const doc = new mupdf.PDFDocument(buf)
  const page = doc.loadPage(pageIndex)
  const json = JSON.parse(page.toStructuredText().asJSON())
  const out = []
  for (const block of json.blocks) {
    if (block.type !== 'text') continue
    for (const ln of block.lines) {
      if (!ln.text || !ln.text.trim()) continue
      const size = (ln.font && ln.font.size) || 10
      const h = size * 0.5
      out.push({
        x: ln.bbox.x,
        top: ln.y - h,
        w: ln.bbox.w,
        h,
        text: ln.text,
        fontSize: size
      })
    }
  }
  return out
}

/** Numero di pagine, senza aprire due volte il documento a mano. */
export async function countPages(buf) {
  const mupdf = (await import('mupdf')).default
  return new mupdf.PDFDocument(buf).countPages()
}
