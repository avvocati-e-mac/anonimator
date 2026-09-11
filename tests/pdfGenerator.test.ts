import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, copyFile, readFile, readdir, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import type { DetectedEntity } from '../src/shared/types'

// Mock electron — non c'è finestra Electron in vitest.
vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
    isPackaged: false
  }
}))

import {
  MAX_REDACTION_AREA_RATIO,
  computeSizeWarning,
  evaluatePageImageSafety,
  generatePdf,
  generatePdfFromImage,
  isRedactionAreaAcceptable,
  matchEntitiesInWords,
  pixelBoxToPdfPoints,
  selectRedactionMode,
  validateRedactedBytes
} from '../src/main/outputGenerators/pdfGenerator'
import type { OcrWord } from '../src/main/outputGenerators/pdfGenerator'
import { generateOutput } from '../src/main/outputGenerators/index'

const FIXTURES = join(__dirname, 'fixtures')
const CORPUS_IMG = join(__dirname, 'corpus-ocr', 'immagine')

// ─── Helper ───────────────────────────────────────────────────────────────────

function entita(originalText: string, pseudonym: string): DetectedEntity {
  return {
    id: randomUUID(),
    type: 'PERSONA',
    originalText,
    pseudonym,
    occurrences: 1,
    confirmed: true
  }
}

async function loadMupdf() {
  return (await import('mupdf')).default
}

/** Copia una fixture in una cartella temporanea: l'output finisce accanto all'input. */
async function inCartellaTemporanea(fixturePath: string): Promise<{ input: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'anonimator-pdfgen-'))
  const input = join(dir, 'doc.pdf')
  await copyFile(fixturePath, input)
  return { input, dir }
}

interface FrazioneRect { x0: number; y0: number; x1: number; y1: number }

/**
 * Frazione di pixel scuri in una regione dell'IMMAGINE incorporata (non della pagina
 * renderizzata). Serve a guardare sotto il rettangolo che pdf-lib disegna sopra: se il
 * metodo 2 ha funzionato, i pixel dell'immagine sono bianchi indipendentemente
 * dall'overlay.
 */
async function inchiostroImmagine(
  filePath: string,
  pageIndex: number,
  frac: FrazioneRect
): Promise<number | null> {
  const mupdf = await loadMupdf()
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(filePath)))
  const page = doc.loadPage(pageIndex)
  const xobjects = page.getObject().getInheritable('Resources').get('XObject')
  if (!xobjects.isDictionary()) return null

  let ref: import('mupdf').PDFObject | null = null
  xobjects.forEach((value) => {
    if (ref !== null) return
    const subtype = value.resolve().get('Subtype')
    if (subtype.isName() && subtype.asName() === 'Image') ref = value
  })
  if (ref === null) return null

  const pixmap = doc.loadImage(ref).toPixmap()
  try {
    const w = pixmap.getWidth()
    const h = pixmap.getHeight()
    const stride = pixmap.getStride()
    const comps = pixmap.getNumberOfComponents()
    const pixels = pixmap.getPixels()
    if (w <= 0 || h <= 0 || pixels.length < stride * h) return null

    const X0 = Math.max(0, Math.floor(frac.x0 * w))
    const X1 = Math.min(w, Math.ceil(frac.x1 * w))
    const Y0 = Math.max(0, Math.floor(frac.y0 * h))
    const Y1 = Math.min(h, Math.ceil(frac.y1 * h))

    let scuri = 0
    let totale = 0
    for (let y = Y0; y < Y1; y++) {
      const base = y * stride
      for (let x = X0; x < X1; x++) {
        totale += 1
        if (pixels[base + x * comps] < 160) scuri += 1
      }
    }
    return totale > 0 ? scuri / totale : null
  } finally {
    pixmap.destroy()
  }
}

/** Frazione di pixel scuri in una regione della PAGINA renderizzata (overlay incluso). */
async function inchiostroPagina(
  filePath: string,
  pageIndex: number,
  frac: FrazioneRect
): Promise<number | null> {
  const mupdf = await loadMupdf()
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(filePath)))
  const pixmap = doc
    .loadPage(pageIndex)
    .toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false, false)
  try {
    const w = pixmap.getWidth()
    const h = pixmap.getHeight()
    const stride = pixmap.getStride()
    const pixels = pixmap.getPixels()
    if (w <= 0 || h <= 0 || pixels.length < stride * h) return null
    const X0 = Math.max(0, Math.floor(frac.x0 * w))
    const X1 = Math.min(w, Math.ceil(frac.x1 * w))
    const Y0 = Math.max(0, Math.floor(frac.y0 * h))
    const Y1 = Math.min(h, Math.ceil(frac.y1 * h))
    let scuri = 0
    let totale = 0
    for (let y = Y0; y < Y1; y++) {
      const base = y * stride
      for (let x = X0; x < X1; x++) {
        totale += 1
        if (pixels[base + x] < 160) scuri += 1
      }
    }
    return totale > 0 ? scuri / totale : null
  } finally {
    pixmap.destroy()
  }
}

/** Rettangolo (in frazioni di pagina) del primo risultato di ricerca per `needle`. */
async function rettangoloRicerca(
  filePath: string,
  pageIndex: number,
  needle: string
): Promise<FrazioneRect | null> {
  const mupdf = await loadMupdf()
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(filePath)))
  const page = doc.loadPage(pageIndex)
  const hits = page.search(needle)
  if (hits.length === 0) return null
  const bounds = page.getBounds()
  const W = bounds[2] - bounds[0]
  const H = bounds[3] - bounds[1]

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const quad of hits[0]) {
    for (let i = 0; i < 8; i += 2) {
      x0 = Math.min(x0, quad[i]); x1 = Math.max(x1, quad[i])
      y0 = Math.min(y0, quad[i + 1]); y1 = Math.max(y1, quad[i + 1])
    }
  }
  return { x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H }
}

// ─── 1. Scelta del modo ───────────────────────────────────────────────────────

describe('selectRedactionMode', () => {
  it('PDF digitale → modo digital (percorso storico, non toccato)', () => {
    expect(selectRedactionMode({ layerKind: 'digital' })).toBe('digital')
    expect(selectRedactionMode({})).toBe('digital')
  })

  it('scansione con layer di testo allineato → percorso veloce sul layer', () => {
    expect(selectRedactionMode({ layerKind: 'scan-with-text', ocrAligned: true }))
      .toBe('pixels-from-text-layer')
  })

  it('scansione senza layer di testo → box da Tesseract', () => {
    expect(selectRedactionMode({ layerKind: 'scan-no-text' })).toBe('pixels-from-ocr')
  })

  it('layer di testo non allineato o incerto → box da Tesseract (prudenza)', () => {
    expect(selectRedactionMode({ layerKind: 'scan-with-text', ocrAligned: false }))
      .toBe('pixels-from-ocr')
    // ocrAligned assente = verdetto incerto: l'incertezza costa tempo, non correttezza.
    expect(selectRedactionMode({ layerKind: 'scan-with-text' })).toBe('pixels-from-ocr')
  })

  it('isScanned acceso non produce mai il percorso nativo', () => {
    expect(selectRedactionMode({ isScanned: true })).toBe('pixels-from-ocr')
    expect(selectRedactionMode({ isScanned: true, layerKind: 'digital' })).toBe('pixels-from-ocr')
    expect(selectRedactionMode({ isScanned: true, layerKind: 'scan-with-text', ocrAligned: true }))
      .toBe('pixels-from-text-layer')
  })
})

// ─── 2. Mappatura pixel ↔ punti a DPI diversi ─────────────────────────────────

describe('pixelBoxToPdfPoints', () => {
  // Lo stesso box in pixel significa cose diverse a DPI diversi: è il difetto che
  // passerebbe inosservato se il DPI fosse una costante scritta a mano in due file.
  const box = { x0: 300, y0: 600, x1: 900, y1: 750 }

  it('a 150 DPI converte con scala 150/72', () => {
    const r = pixelBoxToPdfPoints(box, 150, 0, 0, 0)
    expect(r.x0).toBeCloseTo(144, 6)   // 300 / (150/72)
    expect(r.y0).toBeCloseTo(288, 6)
    expect(r.x1).toBeCloseTo(432, 6)
    expect(r.y1).toBeCloseTo(360, 6)
  })

  it('a 300 DPI lo stesso box in pixel vale la metà dei punti', () => {
    const r = pixelBoxToPdfPoints(box, 300, 0, 0, 0)
    expect(r.x0).toBeCloseTo(72, 6)
    expect(r.y0).toBeCloseTo(144, 6)
    expect(r.x1).toBeCloseTo(216, 6)
    expect(r.y1).toBeCloseTo(180, 6)
  })

  it('a 72 DPI è l\'identità (caso immagine incapsulata: 1 pixel = 1 punto)', () => {
    const r = pixelBoxToPdfPoints(box, 72, 0, 0, 0)
    expect(r.x0).toBeCloseTo(300, 6)
    expect(r.y1).toBeCloseTo(750, 6)
  })

  it('applica origine della pagina e padding', () => {
    const r = pixelBoxToPdfPoints(box, 150, 10, 20, 1)
    expect(r.x0).toBeCloseTo(144 + 10 - 1, 6)
    expect(r.y0).toBeCloseTo(288 + 20 - 1, 6)
    expect(r.x1).toBeCloseTo(432 + 10 + 1, 6)
    expect(r.y1).toBeCloseTo(360 + 20 + 1, 6)
  })
})

// ─── 3. Guardia del 25% ───────────────────────────────────────────────────────

describe('isRedactionAreaAcceptable', () => {
  const W = 595
  const H = 842

  it('accetta un normale box parola', () => {
    expect(isRedactionAreaAcceptable({ x0: 100, y0: 100, x1: 250, y1: 112 }, W, H)).toBe(true)
  })

  it('accetta esattamente il limite del 25%', () => {
    const h = (MAX_REDACTION_AREA_RATIO * W * H) / W
    expect(isRedactionAreaAcceptable({ x0: 0, y0: 0, x1: W, y1: h }, W, H)).toBe(true)
  })

  it('rifiuta oltre il 25% della pagina', () => {
    const h = (MAX_REDACTION_AREA_RATIO * W * H) / W + 1
    expect(isRedactionAreaAcceptable({ x0: 0, y0: 0, x1: W, y1: h }, W, H)).toBe(false)
    expect(isRedactionAreaAcceptable({ x0: 0, y0: 0, x1: W, y1: H }, W, H)).toBe(false)
  })

  it('rifiuta rettangoli degeneri e pagine di area nulla', () => {
    expect(isRedactionAreaAcceptable({ x0: 10, y0: 10, x1: 10, y1: 20 }, W, H)).toBe(false)
    expect(isRedactionAreaAcceptable({ x0: 10, y0: 10, x1: 20, y1: 5 }, W, H)).toBe(false)
    expect(isRedactionAreaAcceptable({ x0: 0, y0: 0, x1: 5, y1: 5 }, 0, H)).toBe(false)
  })
})

// ─── 4. Segnalazione dimensione ───────────────────────────────────────────────

describe('computeSizeWarning', () => {
  it('non segnala una crescita modesta', () => {
    const r = computeSizeWarning(1_000_000, 2_000_000)
    expect(r.sizeRatio).toBe(2)
    expect(r.sizeWarning).toBe(false)
  })

  it('segnala oltre 3x', () => {
    expect(computeSizeWarning(1_000_000, 3_500_000).sizeWarning).toBe(true)
  })

  it('segnala oltre 20 MB anche con rapporto basso', () => {
    const r = computeSizeWarning(30 * 1024 * 1024, 31 * 1024 * 1024)
    expect(r.sizeRatio).toBeLessThan(2)
    expect(r.sizeWarning).toBe(true)
  })
})

// ─── 5. Ricerca delle entità fra le parole OCR ────────────────────────────────

describe('matchEntitiesInWords', () => {
  const parola = (text: string, x0: number): OcrWord => ({
    text,
    bbox: { x0, y0: 100, x1: x0 + 40, y1: 120 }
  })

  it('unisce parole consecutive sulla stessa riga', () => {
    const words = [parola('Il', 0), parola('sig.', 50), parola('Mario', 100), parola('Rossi,', 150)]
    const match = matchEntitiesInWords(words, [entita('Mario Rossi', 'PERSONA_1')])
    expect(match).toHaveLength(1)
    expect(match[0].pseudo).toBe('PERSONA_1')
    expect(match[0].pixelRect).toEqual({ x0: 100, y0: 100, x1: 190, y1: 120 })
  })

  it('non unisce parole su righe diverse', () => {
    const words = [
      parola('Mario', 100),
      { text: 'Rossi', bbox: { x0: 150, y0: 300, x1: 190, y1: 320 } }
    ]
    expect(matchEntitiesInWords(words, [entita('Mario Rossi', 'PERSONA_1')])).toHaveLength(0)
  })
})

// ─── 6. Guardie su trasparenza e spazio colore ────────────────────────────────

describe('evaluatePageImageSafety', () => {
  async function verdetto(file: string) {
    const mupdf = await loadMupdf()
    const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(file)))
    return evaluatePageImageSafety(doc.loadPage(0))
  }

  it('immagine con /SMask → ricaduta su overlay', async () => {
    const r = await verdetto(join(CORPUS_IMG, 'img-11-smask.pdf'))
    expect(r.safe).toBe(false)
    expect(r.reason).toBe('transparency-mask')
  }, 20000)

  it('spazio colore Indexed → ricaduta su overlay (bug 709269, non corretto in 1.27)', async () => {
    const r = await verdetto(join(CORPUS_IMG, 'img-12-indexed.pdf'))
    expect(r.safe).toBe(false)
    expect(r.reason).toBe('non-basic-colorspace')
  }, 20000)

  it('DeviceGray semplice (anche CCITT G4) → azzeramento pixel consentito', async () => {
    expect((await verdetto(join(CORPUS_IMG, 'img-14-g4-grande.pdf'))).safe).toBe(true)
    expect((await verdetto(join(CORPUS_IMG, 'img-13-xobject-condiviso.pdf'))).safe).toBe(true)
  }, 20000)

  it('pagina senza immagini → nessun rischio', async () => {
    const r = await verdetto(join(FIXTURES, 'sample.pdf'))
    expect(r.safe).toBe(true)
    expect(r.reason).toBe('no-images')
  }, 20000)
})

// ─── 7. Non regressione del percorso digitale ─────────────────────────────────

describe('percorso digital (non regressione)', () => {
  it('usa applyRedactions(false, REDACT_IMAGE_NONE) come nelle versioni precedenti', async () => {
    const mupdf = await loadMupdf()
    const { input, dir } = await inCartellaTemporanea(join(FIXTURES, 'sample.pdf'))
    const chiamate: Array<[boolean | undefined, number | undefined]> = []
    const originale = mupdf.PDFPage.prototype.applyRedactions
    const spy = vi
      .spyOn(mupdf.PDFPage.prototype, 'applyRedactions')
      .mockImplementation(function (this: import('mupdf').PDFPage, b?: boolean, im?: number) {
        chiamate.push([b, im])
        return originale.call(this, b, im)
      })

    try {
      const res = await generatePdf(input, [entita('Mario Rossi', 'PERSONA_1')], {})
      expect(res.redactionMode).toBe('digital')
      expect(res.entitiesReplaced).toBe(1)

      // Il testo originale non è più nel documento, lo pseudonimo sì.
      const testo = testoDocumento(
        new mupdf.PDFDocument(new Uint8Array(await readFile(res.outputPath)))
      )
      expect(testo).not.toContain('Mario Rossi')
      expect(testo).toContain('PERSONA_1')

      expect(chiamate.length).toBeGreaterThan(0)
      for (const [blackBoxes, imageMethod] of chiamate) {
        expect(blackBoxes).toBe(false)
        expect(imageMethod).toBe(mupdf.PDFPage.REDACT_IMAGE_NONE)
      }
    } finally {
      spy.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('confine fail-closed dell’entry point pubblico', () => {
  it('rispetta il routing flattened esplicito anche per una sorgente con layer digitale', async () => {
    const { input, dir } = await inCartellaTemporanea(join(FIXTURES, 'sample.pdf'))

    try {
      const result = await generatePdf(input, [entita('Mario Rossi', 'PERSONA_1')], {
        routing: 'flattened-scan',
        layerKind: 'digital',
      })
      expect(result.redactionMode).toBe('flattened-scan')

      const mupdf = await loadMupdf()
      const source = new mupdf.PDFDocument(new Uint8Array(await readFile(input)))
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(output.countPages()).toBe(source.countPages())
        expect(testoDocumento(output)).not.toContain('Mario Rossi')
      } finally {
        source.destroy()
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('senza artefatto OCR token-bound non scrive alcun output per una scansione non attendibile', async () => {
    const { input, dir } = await inCartellaTemporanea(
      join(CORPUS_IMG, 'img-13-xobject-condiviso.pdf')
    )

    try {
      await expect(generatePdf(input, [entita('Mario Rossi', 'PERSONA_1')], {
        layerKind: 'scan-no-text',
        ocrAligned: false,
      })).rejects.toMatchObject({ code: 'ocr-artifact-missing' })

      expect((await readdir(dir)).filter((name) => name.includes('_anonimizzato'))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('senza artefatto OCR token-bound non scrive output neppure dall’entry point immagini', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-image-entry-'))
    const input = join(dir, 'immagine-sintetica.png')
    await sharp({
      create: { width: 320, height: 200, channels: 3, background: '#ffffff' },
    }).png().toFile(input)

    try {
      await expect(generatePdfFromImage(input, [entita('Mario Rossi', 'PERSONA_1')]))
        .rejects.toMatchObject({ code: 'ocr-artifact-missing' })
      expect((await readdir(dir)).filter((name) => name.includes('_anonimizzato'))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

// ─── 8-9. Percorso a pixel su scansione con layer di testo allineato ──────────

describe('percorso pixels-from-text-layer', () => {
  /**
   * Costruisce un PDF a due pagine che condividono **lo stesso** XObject immagine, con
   * testo cercabile solo sulla prima. È la forma asimmetrica che serve al test: nel
   * corpus img-13 le due pagine hanno layer di testo identici, quindi verrebbero
   * redatte entrambe e la condivisione dell'oggetto resterebbe invisibile.
   */
  async function fixtureXObjectCondiviso(dir: string): Promise<string> {
    const mupdf = await loadMupdf()
    const src = new mupdf.PDFDocument(
      new Uint8Array(await readFile(join(CORPUS_IMG, 'img-13-xobject-condiviso.pdf')))
    )
    const pixmap = src
      .loadPage(0)
      .toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, false)
    const png = Uint8Array.from(pixmap.asPNG())
    pixmap.destroy()

    const doc = await PDFDocument.create()
    const img = await doc.embedPng(png)
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([595, 842])
      // Stesso oggetto immagine su entrambe le pagine.
      page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
      if (i === 0) {
        page.drawText('Mario Rossi', { x: 60, y: 700, size: 14, font, color: rgb(0, 0, 0) })
      }
    }
    const out = join(dir, 'condiviso.pdf')
    await writeFile(out, await doc.save())
    return out
  }

  it('redazione sulla pagina 1 → pagina 2 integra, pur condividendo lo XObject', async () => {
    const mupdf = await loadMupdf()
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-pdfgen-'))

    try {
      const input = await fixtureXObjectCondiviso(dir)

      const rect = await rettangoloRicerca(input, 0, 'Mario Rossi')
      expect(rect).not.toBeNull()
      if (rect === null) return

      const primaPag1 = await inchiostroImmagine(input, 0, rect)
      const primaPag2 = await inchiostroImmagine(input, 1, rect)
      expect(primaPag1).not.toBeNull()
      expect(primaPag1 ?? 0).toBeGreaterThan(0.02)
      expect(primaPag2 ?? 0).toBeCloseTo(primaPag1 ?? 0, 6)

      const chiamate: Array<[boolean | undefined, number | undefined]> = []
      const originale = mupdf.PDFPage.prototype.applyRedactions
      const spy = vi
        .spyOn(mupdf.PDFPage.prototype, 'applyRedactions')
        .mockImplementation(function (this: import('mupdf').PDFPage, b?: boolean, im?: number) {
          chiamate.push([b, im])
          return originale.call(this, b, im)
        })

      try {
        const res = await generatePdf(input, [entita('Mario Rossi', 'PERSONA_1')], {
          layerKind: 'scan-with-text',
          ocrAligned: true
        })

        expect(res.redactionMode).toBe('flattened-scan')
        expect(res.entitiesReplaced).toBe(1)
        // Il nuovo documento raster non usa applyRedactions sul sorgente.
        expect(chiamate).toEqual([])

        // Pagina 1: il raster incorporato è stato riscritto nella regione sensibile.
        const dopoPag1 = await inchiostroImmagine(res.outputPath, 0, rect)
        expect(dopoPag1).not.toBeNull()
        expect(Math.abs((dopoPag1 ?? 0) - (primaPag1 ?? 0))).toBeGreaterThan(0.2)

        // Pagina 2: nessuna redazione, l'immagine condivisa deve restare com'era.
        const dopoPag2 = await inchiostroImmagine(res.outputPath, 1, rect)
        expect(dopoPag2).not.toBeNull()
        expect(dopoPag2 ?? 0).toBeCloseTo(primaPag2 ?? 0, 3)

        // L'overlay con lo pseudonimo è disegnato sopra: la regione renderizzata è
        // scura anche se i pixel dell'immagine sottostante sono bianchi.
        const resaPag1 = await inchiostroPagina(res.outputPath, 0, rect)
        expect(resaPag1 ?? 0).toBeGreaterThan(0.5)
        const testo = testoDocumento(
          new mupdf.PDFDocument(new Uint8Array(await readFile(res.outputPath)))
        )
        expect(testo).not.toContain('Mario Rossi')
        // v1.6 è deliberatamente raster-only; il layer pseudonimizzato arriva in v1.7.
        expect(testo).not.toContain('PERSONA_1')

        expect(res.sizeRatio).toBeGreaterThan(0)
      } finally {
        spy.mockRestore()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60000)

  it('SMask e Indexed vengono ricostruiti senza fallback overlay', async () => {
    const mupdf = await loadMupdf()
    for (const fixture of ['img-11-smask.pdf', 'img-12-indexed.pdf']) {
      const { input, dir } = await inCartellaTemporanea(join(CORPUS_IMG, fixture))
      const chiamate: Array<number | undefined> = []
      const originale = mupdf.PDFPage.prototype.applyRedactions
      const spy = vi
        .spyOn(mupdf.PDFPage.prototype, 'applyRedactions')
        .mockImplementation(function (this: import('mupdf').PDFPage, b?: boolean, im?: number) {
          chiamate.push(im)
          return originale.call(this, b, im)
        })

      try {
        const res = await generatePdf(input, [entita('Mario Rossi', 'PERSONA_1')], {
          layerKind: 'scan-with-text',
          ocrAligned: true
        })
        expect(res.redactionMode, fixture).toBe('flattened-scan')
        expect(res.entitiesReplaced, fixture).toBe(1)
        expect(chiamate, fixture).toEqual([])
      } finally {
        spy.mockRestore()
        await rm(dir, { recursive: true, force: true })
      }
    }
  }, 60000)

  it('misura il rapporto di dimensione su un CCITT G4 (caso realistico di deposito)', async () => {
    const { input, dir } = await inCartellaTemporanea(join(CORPUS_IMG, 'img-14-g4-grande.pdf'))
    try {
      const res = await generatePdf(input, [entita('Mario Rossi', 'PERSONA_1')], {
        layerKind: 'scan-with-text',
        ocrAligned: true
      })
      expect(res.redactionMode).toBe('flattened-scan')
      expect(res.sizeRatio).toBeDefined()
      expect(res.sizeRatio ?? 0).toBeGreaterThan(0)
      expect(typeof res.sizeWarning).toBe('boolean')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60000)
})

/** Testo di tutte le pagine. Il corpus è sintetico e finto: nessun dato reale. */
function testoDocumento(doc: import('mupdf').PDFDocument): string {
  const parti: string[] = []
  for (let i = 0; i < doc.countPages(); i++) {
    parti.push(doc.loadPage(i).toStructuredText('preserve-whitespace').asText())
  }
  return parti.join('\n')
}

// ─── 10. Validazione post-scrittura (l'interruttore d'emergenza) ──────────────

describe('validateRedactedBytes', () => {
  it('respinge byte che non sono un PDF', async () => {
    const mupdf = await loadMupdf()
    const r = validateRedactedBytes(mupdf, new Uint8Array([1, 2, 3, 4]), 1, 0.1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unreadable')
  }, 20000)

  it('respinge un output con numero di pagine diverso dall\'originale', async () => {
    const mupdf = await loadMupdf()
    const bytes = new Uint8Array(await readFile(join(FIXTURES, 'sample.pdf')))
    const r = validateRedactedBytes(mupdf, bytes, 99, 0.1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('page-count-mismatch')
  }, 20000)

  it('respinge una pagina svuotata quando l\'originale aveva inchiostro', async () => {
    const mupdf = await loadMupdf()
    const doc = await PDFDocument.create()
    doc.addPage([595, 842]) // pagina bianca
    const r = validateRedactedBytes(mupdf, await doc.save(), 1, 0.3)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('page-blanked')
  }, 20000)

  it('respinge una pagina annerita', async () => {
    const mupdf = await loadMupdf()
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0, 0, 0) })
    const r = validateRedactedBytes(mupdf, await doc.save(), 1, 0.3)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('page-blackened')
  }, 20000)

  it('accetta un documento sano', async () => {
    const mupdf = await loadMupdf()
    const bytes = new Uint8Array(await readFile(join(FIXTURES, 'sample.pdf')))
    const r = validateRedactedBytes(mupdf, bytes, 1, 0.05)
    expect(r.ok).toBe(true)
    expect(r.inkFraction).toBeGreaterThan(0)
  }, 20000)

  it('accetta una pagina vuota se anche l\'originale era vuota', async () => {
    const mupdf = await loadMupdf()
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const r = validateRedactedBytes(mupdf, await doc.save(), 1, 0)
    expect(r.ok).toBe(true)
  }, 20000)
})

// ─── 11. Flusso batch: layerKind assente, ricavato da generateOutput ──────────

describe('generateOutput senza layerKind (flusso batch)', () => {
  it('ricava da sé la natura del PDF e non lascia la scansione sul percorso nativo', async () => {
    const mupdf = await loadMupdf()
    const { input, dir } = await inCartellaTemporanea(
      join(CORPUS_IMG, 'img-13-xobject-condiviso.pdf')
    )
    const metodi: Array<number | undefined> = []
    const originale = mupdf.PDFPage.prototype.applyRedactions
    const spy = vi
      .spyOn(mupdf.PDFPage.prototype, 'applyRedactions')
      .mockImplementation(function (this: import('mupdf').PDFPage, b?: boolean, im?: number) {
        metodi.push(im)
        return originale.call(this, b, im)
      })

    try {
      // BatchAnonymizeRequest non porta layerKind: senza la deduzione interna questa
      // scansione finirebbe sul percorso nativo e i pixel resterebbero nel file.
      const res = await generateOutput(input, 'pdf', [entita('Mario Rossi', 'PERSONA_1')], {})
      expect(res.redactionMode).toBe('flattened-scan')
      expect(metodi).toEqual([])
    } finally {
      spy.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60000)

  it('un PDF nativo resta sul percorso digital anche passando da generateOutput', async () => {
    const mupdf = await loadMupdf()
    const { input, dir } = await inCartellaTemporanea(join(FIXTURES, 'sample.pdf'))
    const metodi: Array<number | undefined> = []
    const originale = mupdf.PDFPage.prototype.applyRedactions
    const spy = vi
      .spyOn(mupdf.PDFPage.prototype, 'applyRedactions')
      .mockImplementation(function (this: import('mupdf').PDFPage, b?: boolean, im?: number) {
        metodi.push(im)
        return originale.call(this, b, im)
      })

    try {
      const res = await generateOutput(input, 'pdf', [entita('Mario Rossi', 'PERSONA_1')], {})
      expect(res.redactionMode).toBe('digital')
      expect(metodi).toEqual([mupdf.PDFPage.REDACT_IMAGE_NONE])
    } finally {
      spy.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60000)
})
