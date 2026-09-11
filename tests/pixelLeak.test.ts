/**
 * Prova della fuga di pixel — il test che verifica ciò che il prodotto promette.
 *
 * Tutto il resto della suite verifica dei pezzi: le soglie, le coordinate, le
 * guardie. Questo verifica il risultato, e lo fa **dall'esterno del PDF**, con
 * lo stesso strumento che userebbe chi volesse recuperare i dati:
 *
 *     pdfimages documento_anonimizzato.pdf /tmp/estratte
 *
 * Prima della redazione reale dei pixel, il riquadro grigio disegnato sopra era
 * solo un `drawRectangle` di pdf-lib: l'oggetto immagine originale restava
 * intatto nel content stream, e questo comando ne recuperava il contenuto in
 * chiaro mentre l'app dichiarava "12 entità sostituite". La prova è quindi che
 * l'area redatta risulti **bianca nell'immagine estratta**, non nella pagina
 * renderizzata.
 *
 * `pdfimages` (Poppler) è un prerequisito obbligatorio del gate quality.
 * Se manca, la suite deve fallire: un controllo di sicurezza saltato non è verde.
 */
import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, copyFile, readFile, rm } from 'fs/promises'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import type { DetectedEntity } from '../src/shared/types'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
    isPackaged: false
  }
}))

import { generatePdf } from '../src/main/outputGenerators/pdfGenerator'
import { generateImagePdfSafe } from '../src/main/outputGenerators/pdfSafeGenerator'
import { buildImagePixelMatrix } from '../src/main/parsers/ocrParser'
import { ocrArtifactCache } from '../src/main/services/ocrArtifactCache'

const FIXTURE = join(__dirname, 'corpus-ocr', 'negativi', 'neg-02-allineato-flate.pdf')
const FIXTURE_SMASK = join(__dirname, 'corpus-ocr', 'immagine', 'img-11-smask.pdf')

interface GrayImage {
  width: number
  height: number
  /** Luminanza 0-255, un valore per pixel. */
  pixels: Uint8Array
}

/**
 * Legge un PPM binario (P6) — il formato che `pdfimages` produce senza opzioni.
 * Volutamente minimale: serve solo per le immagini che genera questo test.
 */
function readPpm(buf: Buffer): GrayImage {
  if (buf.subarray(0, 2).toString('ascii') !== 'P6') {
    throw new Error('formato inatteso: pdfimages non ha prodotto un PPM binario')
  }
  const campi: number[] = []
  let i = 2
  while (campi.length < 3) {
    while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++
    if (buf[i] === 0x23) {           // commento: salta fino a fine riga
      while (i < buf.length && buf[i] !== 0x0a) i++
      continue
    }
    let n = 0
    while (i < buf.length && buf[i] >= 0x30 && buf[i] <= 0x39) {
      n = n * 10 + (buf[i] - 0x30)
      i++
    }
    campi.push(n)
  }
  i++ // il singolo carattere di spaziatura dopo maxval
  const [width, height] = campi
  const pixels = new Uint8Array(width * height)
  for (let p = 0; p < width * height; p++) {
    const b = i + p * 3
    // Luminanza approssimata: le fixture sono in scala di grigi, i tre canali
    // coincidono, quindi la media è esatta e non serve la formula pesata.
    pixels[p] = Math.round((buf[b] + buf[b + 1] + buf[b + 2]) / 3)
  }
  return { width, height, pixels }
}

/** Frazione di pixel scuri (inchiostro) in un rettangolo, in coordinate pixel. */
function frazioneScura(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const xa = Math.max(0, Math.floor(x0))
  const ya = Math.max(0, Math.floor(y0))
  const xb = Math.min(img.width, Math.ceil(x1))
  const yb = Math.min(img.height, Math.ceil(y1))
  if (xb <= xa || yb <= ya) throw new Error('rettangolo degenere')
  let scuri = 0
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      if (img.pixels[y * img.width + x] < 128) scuri++
    }
  }
  return scuri / ((xb - xa) * (yb - ya))
}

/** Estrae la prima immagine del PDF e la restituisce in scala di grigi. */
async function primaImmagine(pdfPath: string, dir: string, prefisso: string): Promise<GrayImage> {
  const radice = join(dir, prefisso)
  execFileSync('pdfimages', [pdfPath, radice], { stdio: 'ignore' })
  return readPpm(await readFile(`${radice}-000.ppm`))
}

function entita(originalText: string, pseudonym: string): DetectedEntity {
  return {
    id: randomUUID(),
    type: 'PERSONA',
    originalText,
    pseudonym,
    source: 'regex',
    confirmed: true,
    occurrences: 1
  }
}

function mediaLuminanza(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const xa = Math.max(0, Math.floor(x0))
  const ya = Math.max(0, Math.floor(y0))
  const xb = Math.min(img.width, Math.ceil(x1))
  const yb = Math.min(img.height, Math.ceil(y1))
  if (xb <= xa || yb <= ya) throw new Error('rettangolo degenere')
  let totale = 0
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) totale += img.pixels[y * img.width + x]
  }
  return totale / ((xb - xa) * (yb - ya))
}

function frazioneModificata(
  before: GrayImage,
  after: GrayImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threshold = 20,
): number {
  const xa = Math.max(0, Math.floor(x0))
  const ya = Math.max(0, Math.floor(y0))
  const xb = Math.min(before.width, after.width, Math.ceil(x1))
  const yb = Math.min(before.height, after.height, Math.ceil(y1))
  if (xb <= xa || yb <= ya) throw new Error('rettangolo degenere')
  let changed = 0
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const index = y * before.width + x
      if (Math.abs(after.pixels[index] - before.pixels[index]) > threshold) changed++
    }
  }
  return changed / ((xb - xa) * (yb - ya))
}

describe('prova della fuga di pixel (pdfimages)', () => {
  it(
    'i pixel del nome spariscono dall\'immagine estratta, non solo dalla pagina',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'anonimator-pixelleak-'))
      try {
        const input = join(dir, 'scansione.pdf')
        await copyFile(FIXTURE, input)

        // Il layer di testo di questa fixture è allineato: è il caso in cui il
        // codice sceglie page.search() sul layer e azzera davvero i pixel.
        const res = await generatePdf(input, [entita('Mario Rossi', 'M. R.')], {
          routing: 'flattened-scan',
          isScanned: true,
          layerKind: 'scan-with-text',
          ocrAligned: true
        })
        expect(res.redactionMode).toBe('flattened-scan')
        expect(res.entitiesReplaced).toBeGreaterThan(0)

        const prima = await primaImmagine(input, dir, 'in')
        const dopo = await primaImmagine(res.outputPath, dir, 'out')
        expect(dopo.width).toBe(prima.width)
        expect(dopo.height).toBe(prima.height)

        // Il raster copre l'intera pagina A4 (595x842 pt), quindi il fattore di
        // conversione punti -> pixel è semplicemente la larghezza dell'immagine
        // divisa per la larghezza della pagina.
        const k = prima.width / 595
        // Quad restituito da page.search('Mario') su questa fixture, in punti:
        // x 124-149, y 131-141. Si campiona la banda dei glifi, non l'intero
        // riquadro di riga, per non includere l'interlinea bianca.
        const x0 = 124 * k
        const x1 = 149 * k
        const y0 = 132 * k
        const y1 = 140 * k

        // Prima: lì dentro c'è inchiostro.
        expect(frazioneScura(prima, x0, y0, x1, y1)).toBeGreaterThan(0.1)

        // Dopo: nell'immagine ESTRATTA la regione è stata sostituita dal riquadro
        // e dallo pseudonimo; i glifi originali non sono più il raster sottostante.
        expect(
          Math.abs(frazioneScura(dopo, x0, y0, x1, y1) - frazioneScura(prima, x0, y0, x1, y1))
        ).toBeGreaterThan(0.2)

        // E il resto della riga è ancora lì: si è redatto il nome, non
        // cancellata la pagina. Senza questo controllo il test passerebbe anche
        // se la redazione avesse sbiancato tutto.
        const restoRigaPrima = frazioneScura(prima, 300 * k, y0, 440 * k, y1)
        const restoRigaDopo = frazioneScura(dopo, 300 * k, y0, 440 * k, y1)
        expect(restoRigaPrima).toBeGreaterThan(0.1)
        expect(restoRigaDopo).toBeCloseTo(restoRigaPrima, 5)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    60_000
  )

  it(
    'un’immagine standalone redige il bbox nei pixel originali',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'anonimator-image-pixelleak-'))
      const input = join(dir, 'immagine-sintetica.png')
      const width = 240
      const height = 100
      const sensitive = { x0: 60, y0: 30, x1: 140, y1: 60 }
      const raw = Buffer.alloc(width * height * 3, 255)

      // Pattern sintetico ad alto contrasto: il vecchio errore di scala lasciava
      // quasi tutta questa regione invariata e redigeva un riquadro 4,17x più piccolo.
      for (let y = sensitive.y0; y < sensitive.y1; y++) {
        for (let x = sensitive.x0; x < sensitive.x1; x++) {
          const value = ((x - sensitive.x0) % 8) < 4 ? 0 : 255
          const offset = (y * width + x) * 3
          raw[offset] = value
          raw[offset + 1] = value
          raw[offset + 2] = value
        }
      }

      const handle = ocrArtifactCache.stage({
        pages: [{
          page: 1,
          words: [{
            text: 'SOGGETTOALFA',
            bbox: sensitive,
            confidence: 99,
            line: 1,
            page: 1,
          }],
          renderMatrix: buildImagePixelMatrix(),
          pixmapOrigin: { x: 0, y: 0 },
        }],
      })
      const token = randomUUID()
      ocrArtifactCache.bind(handle, token)

      try {
        await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(input)
        const result = await generateImagePdfSafe(
          input,
          [entita('SOGGETTOALFA', 'SOGGETTO_1')],
          token,
        )

        expect(result.safetyStatus).toBe('complete')
        expect(result.outcomes[0]).toMatchObject({
          matchedOccurrences: 1,
          redactedOccurrences: 1,
        })

        const output = await primaImmagine(result.outputPath, dir, 'image-out')
        expect(output.width).toBe(width)
        expect(output.height).toBe(height)

        const mupdf = (await import('mupdf')).default
        const document = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
        try {
          const searchableText = document.loadPage(0).toStructuredText().asText()
          expect(searchableText).not.toContain('SOGGETTOALFA')
          expect(searchableText).toContain('SOGGETTO_1')
        } finally {
          document.destroy()
        }

        const inputImage: GrayImage = {
          width,
          height,
          pixels: Uint8Array.from({ length: width * height }, (_, index) => raw[index * 3]),
        }
        const before = mediaLuminanza(inputImage, sensitive.x0, sensitive.y0, sensitive.x1, sensitive.y1)
        const after = mediaLuminanza(output, sensitive.x0, sensitive.y0, sensitive.x1, sensitive.y1)
        expect(Math.abs(after - before)).toBeGreaterThan(35)
        expect(frazioneModificata(
          inputImage, output, sensitive.x0, sensitive.y0, sensitive.x1, sensitive.y1,
        )).toBeGreaterThan(0.85)

        // Anche tutte le bande di bordo devono risultare coperte: una redazione
        // parziale o traslata non può superare il gate modificando solo il centro.
        const border = 5
        const bands = [
          [sensitive.x0, sensitive.y0, sensitive.x1, sensitive.y0 + border],
          [sensitive.x0, sensitive.y1 - border, sensitive.x1, sensitive.y1],
          [sensitive.x0, sensitive.y0, sensitive.x0 + border, sensitive.y1],
          [sensitive.x1 - border, sensitive.y0, sensitive.x1, sensitive.y1],
        ] as const
        for (const band of bands) {
          expect(frazioneModificata(inputImage, output, ...band)).toBeGreaterThan(0.85)
        }

        // Il controllo a destra non deve essere cancellato insieme al bbox.
        const controlBefore = mediaLuminanza(inputImage, 170, 30, 220, 60)
        const controlAfter = mediaLuminanza(output, 170, 30, 220, 60)
        expect(Math.abs(controlAfter - controlBefore)).toBeLessThan(3)
      } finally {
        ocrArtifactCache.release(token)
        await rm(dir, { recursive: true, force: true })
      }
    },
    60_000,
  )
})

describe('ricostruzione raster su immagini complesse', () => {
  it(
    'un\'immagine con /SMask viene ricostruita e la regione sensibile cambia',
    async () => {
      // Non è un difetto da correggere di nascosto: MuPDF 1.27 gestisce male
      // la trasparenza in redazione ("incorrectly handled", avvertenza non
      // risolta), quindi il codice preferisce un file meno protetto ma integro
      // a uno corrotto. Questo test esiste perché la scelta resti visibile:
      // se un domani qualcuno togliesse la guardia credendola superflua, o
      // aggiornasse MuPDF, il test cambia esito e lo fa notare.
      const dir = await mkdtemp(join(tmpdir(), 'anonimator-pixelleak-smask-'))
      try {
        const input = join(dir, 'scansione-smask.pdf')
        await copyFile(FIXTURE_SMASK, input)

        const res = await generatePdf(input, [entita('Mario Rossi', 'M. R.')], {
          routing: 'flattened-scan',
          isScanned: true,
          layerKind: 'scan-with-text',
          ocrAligned: true
        })

        const prima = await primaImmagine(input, dir, 'in')
        const dopo = await primaImmagine(res.outputPath, dir, 'out')

        const k = prima.width / 595
        const area = [124 * k, 132 * k, 149 * k, 140 * k] as const
        const scuroPrima = frazioneScura(prima, ...area)
        const scuroDopo = frazioneScura(dopo, ...area)

        expect(scuroPrima).toBeGreaterThan(0.1)
        // Il nuovo PDF contiene soltanto il raster ricostruito e pseudonimizzato.
        expect(Math.abs(scuroDopo - scuroPrima)).toBeGreaterThan(0.02)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    60_000
  )
})
