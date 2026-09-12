/**
 * ocrLayerCheck.ts — rilevamento di scansioni con layer di testo OCR disallineato.
 *
 * Problema: un PDF prodotto da scanner/ABBYY/allegato PEC è un'immagine con sopra
 * un layer di testo invisibile. Se quel layer è sfasato rispetto ai pixel, i
 * rettangoli di anonimizzazione finiscono nel punto sbagliato e i nomi restano
 * leggibili. Questo modulo decide se il layer è affidabile.
 *
 * PRIVACY (CLAUDE.md §6): nessuna funzione qui dentro logga o restituisce testo del
 * documento. Il testo estratto viene convertito immediatamente in un conteggio di
 * parole (`words`) e scartato. Tutti i campi di OcrLayerReport sono numerici o
 * etichette da insiemi chiusi.
 */

import { privacyLog as log, safeErrorCode } from './privacyLogger'
import { renderWithinPixelBudget } from './renderBudget'
import type { AffineMatrix } from './geometry'
import { scoreTextQuality } from './textQuality'
import { z } from 'zod'
import type {
  ImageQualityMetrics,
  ImageQualityReason,
  ImageQualityVerdict,
  OcrLayerReport,
  OcrLayerVerdict,
  OcrPageMetrics,
  OcrPageReason,
  PdfLayerKind
} from '@shared/types'

// ============================================================================
// Costanti di taratura — un unico oggetto, così la calibrazione è centralizzata.
// ============================================================================

export const OCR_CHECK_TUNING = {
  /** Pagine campionate al massimo: prima, ultima, tre intermedie distribuite. */
  MAX_PAGES: 5,
  /**
   * DPI di rendering. 72 e NON di più: MuPDF fa decodifica JPEG scalata in dominio
   * DCT e c'è un dirupo a 74 DPI — a 75+ il fattore l2 scende di uno e la decodifica
   * quadruplica (2,18 MPix contro 0,54 su un A4 a 300 DPI).
   */
  RENDER_DPI: 72,

  // --- Binarizzazione (moda della carta, NON Otsu — vedi paperModeThreshold) ---
  /** Primo bin considerato "carta" nella ricerca della moda. */
  PAPER_MODE_MIN_BIN: 128,
  PAPER_MODE_FACTOR: 0.75,
  THRESHOLD_MIN: 40,
  THRESHOLD_MAX: 220,
  /** Sotto questa frazione di inchiostro la pagina è bianca: inconcludente. */
  INK_FRACTION_MIN: 0.004,
  /** Sopra questa frazione la pagina è troppo scura: inconcludente. */
  INK_FRACTION_MAX: 0.45,

  // --- Griglia ---
  /** Lato cella in pixel. A 72 DPI = 4pt ≈ 1,4 mm, appena sotto l'errore che rompe la redazione. */
  CELL_PX: 4,
  /** Pixel sotto soglia perché la cella conti come inchiostro. */
  CELL_MIN_INK_PX: 2,

  // --- Gate ---
  /** Area dei blocchi immagine / area CropBox perché la pagina sia una scansione. */
  IMAGE_AREA_MIN_RATIO: 0.6,
  /** Sotto questo numero di celle-testo non c'è abbastanza segnale. */
  MIN_TEXT_CELLS: 40,
  /** Oltre questa baseline di inchiostro il lift non è più informativo. */
  BASELINE_MAX: 0.5,

  // --- Soglie del verdetto di pagina ---
  COVERAGE_MIN: 0.8,
  LIFT_MIN: 1.35,
  LINE_AGREEMENT_MIN: 0.6,
  /** Sotto queste righe utili lineAgreement è null: meglio astenersi che inventare. */
  LINE_AGREEMENT_MIN_LINES: 8,
  SCALE_TOLERANCE: 0.005,
  OFFSET_MAX_PT: 4,

  // --- Cross-correlazione ---
  CORR_MAX_LAG_PX: 60,

  // --- lineAgreement ---
  /**
   * Un gap >= questa frazione dell'altezza riga separa due "run" di inchiostro.
   *
   * TARATO SU MISURA, non sul valore di 0,3 inizialmente ipotizzato: a 72 DPI uno
   * spazio di parola vale ~0,28 em e l'altezza del bbox di riga ~1,3 em, quindi lo
   * spazio è ~0,22 dell'altezza; gli spazi fra lettere stanno sotto 0,08. Con 0,3 la
   * soglia cade SOPRA lo spazio di parola e l'intera riga collassa in un unico run
   * (misurato su un sandwich Helvetica 12pt: 1-3 run contro 7-10 parole), rendendo
   * lineAgreement un falso positivo sistematico. A 0,22 i run ricalcano le parole.
   */
  LINE_GAP_RATIO: 0.22,
  /** ...ma mai meno di questi pixel, altrimenti gli spazi fra lettere spezzano le parole. */
  LINE_GAP_MIN_PX: 2,
  /** Massa minima di testo per banda in fitScaleY, come frazione del totale. */
  BAND_MIN_MASS_RATIO: 0.1,
  /** Tolleranza sugli estremi orizzontali: pixel assoluti + frazione della larghezza. */
  EXTENT_TOL_PX: 8,
  EXTENT_TOL_RATIO: 0.08,
  /** I run possono essere al più parole + questo (rumore che spezza una parola). */
  RUNS_TOL_ABS: 2,
  /** ...e almeno questa frazione delle parole: a 72 DPI gli spazi stretti fondono
   *  parole vicine, ma oltre il 40% di fusione la riga non accorda più. */
  RUNS_MIN_RATIO: 0.55,
  /** Sopra questa frazione di colonne inchiostrate la banda è un filetto o un
   *  fondo pieno, non testo: la riga esce dal calcolo dell'accordo. */
  BAND_SOLID_RATIO: 0.95,

  // --- Skew ---
  SKEW_MAX_DEG: 5,
  SKEW_STEP_DEG: 0.25,

  // --- Qualità immagine ---
  DPI_POOR: 150,
  DPI_MARGINAL: 200,
  /** Soglia documentata da Tesseract: sotto 8px il testo viene rimosso come rumore. */
  X_HEIGHT_POOR: 8,
  /** Sotto 10px "pochissime probabilità di risultati accurati" (Tesseract). */
  X_HEIGHT_MARGINAL: 10,
  SEPARABILITY_MIN: 0.6,
  SKEW_WARN_DEG: 2,
  SKEW_BAD_DEG: 5,
  /** SEGNALE DEBOLE: non genera mai da solo un avviso. Vedi classifyImageQuality. */
  BLUR_MIN: 0.02,
  /** x-height ≈ metà dell'altezza del bbox di riga (ascender→descender). */
  X_HEIGHT_RATIO: 0.5,
  /**
   * Banda di glifi dentro il bbox di riga, in frazioni dell'altezza.
   *
   * Il bbox di riga va dall'ascender al descender, ma l'inchiostro vive fra l'altezza
   * delle maiuscole (~0,27) e la linea di base (~0,82). Confrontare il bbox PIENO con
   * i pixel significa correlare un'onda quadra con una banda stretta: il picco di
   * correlazione diventa largo e piatto (punteggio 0,54 su una pagina allineata) e il
   * suo argmax salta di ±5px da una banda all'altra, che a sua volta produce un falso
   * errore di scala. Restringere alla banda dei glifi rende il picco netto.
   */
  GLYPH_BAND_TOP: 0.25,
  GLYPH_BAND_BOTTOM: 0.85,
  OCR_DPI_MIN: 200,
  OCR_DPI_MAX: 400,
  OCR_DPI_DEFAULT: 300
} as const

const PT_PER_MM = 25.4 / 72

/** Due punteggi di correlazione entro questo scarto sono considerati pari. */
const TIE_EPSILON = 1e-9

// ============================================================================
// Tipi delle funzioni pure (nessun import di electron o mupdf qui sotto).
// ============================================================================

/** Rettangolo, in pixel del pixmap renderizzato. */
export interface PixelRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Bbox di una riga di testo, in pixel del pixmap.
 * `words` è un CONTEGGIO: il testo della riga non viene mai conservato.
 */
export interface PixelBox extends PixelRect {
  words: number
}

export interface InkGrid {
  cols: number
  rows: number
  cellPx: number
  width: number
  height: number
  /** 1 = cella con inchiostro (>= CELL_MIN_INK_PX pixel sotto soglia). Lunghezza cols*rows. */
  cells: Uint8Array
  /** Pixel scuri per cella, 0..cellPx^2. Conserva il dettaglio sub-cella per estimateSkew. */
  cellInk: Uint16Array
  /**
   * 1 = pixel di inchiostro. Risoluzione piena: serve a lineAgreement, perché a
   * 4px per cella gli spazi fra le parole non sono risolvibili.
   */
  inkMask: Uint8Array
  /** Pixel scuri per riga di pixel. Lunghezza = height. */
  rowProfile: Float64Array
  /** Pixel scuri per colonna di pixel. Lunghezza = width. */
  colProfile: Float64Array
  inkPixels: number
  inkFraction: number
}

export interface TextGrid {
  cols: number
  rows: number
  cellPx: number
  cells: Uint8Array
  rowProfile: Float64Array
  colProfile: Float64Array
  cellCount: number
  /** Bbox clippati all'area immagine, senza i degeneri. */
  boxes: PixelBox[]
}

export interface PageJudgement {
  coverage: number
  lift: number
  lineAgreement: number | null
  scaleY: number
  offsetXPt: number
  offsetYPt: number
}

/** Classificazione di sicurezza per pagina, separata dal report IPC legacy. */
export type PdfPageSafetyStatus =
  | 'digital'
  | 'scan-aligned'
  | 'scan-untrusted'
  | 'page-error'

/** Metriche nullable: null significa "non misurato", mai "misurato come zero". */
export interface NullablePageQualityMetrics {
  coverage: number | null
  lift: number | null
  lineAgreement: number | null
  scaleY: number | null
  offsetXPt: number | null
  offsetYPt: number | null
}

export interface PdfPageQualityOutcome {
  page: number
  status: PdfPageSafetyStatus
  layerKind: PdfLayerKind | null
  /** true soltanto per una pagina raster il cui layer e' risultato allineato. */
  existingTextLayerUsable: boolean
  reason: OcrPageReason
  metrics: NullablePageQualityMetrics
  imageMetrics: ImageQualityMetrics | null
}

export interface PdfDocumentSafety {
  pageCount: number
  /** Ogni PDF contenente almeno una pagina raster segue il percorso raster. */
  routing: 'digital' | 'flattened-scan'
  allPagesAnalyzed: boolean
  hasPageErrors: boolean
  /** true solo quando ogni pagina raster ha un layer certificato allineato. */
  existingTextLayerUsable: boolean
  pages: PdfPageQualityOutcome[]
  /** Campione per la sola diagnostica UI; non influenza mai il routing. */
  diagnosticPageNumbers: number[]
}

export interface PdfQualityAnalysis {
  report: OcrLayerReport
  safety: PdfDocumentSafety
}

// ============================================================================
// Binarizzazione
// ============================================================================

/**
 * Soglia di binarizzazione dalla moda della carta. NON Otsu.
 *
 * Otsu su una pagina quasi vuota taglia *dentro* la distribuzione della carta
 * (es. 244 contro una moda a 248) e produce una maschera che copre il 40% della
 * pagina: con quell'inchiostro fantasma qualunque layer risulterebbe allineato.
 * La moda della carta è stabile perché la carta è sempre la classe dominante.
 */
export function paperModeThreshold(histogram: ArrayLike<number>): number {
  const { PAPER_MODE_MIN_BIN, PAPER_MODE_FACTOR, THRESHOLD_MIN, THRESHOLD_MAX } = OCR_CHECK_TUNING
  let modeBin = PAPER_MODE_MIN_BIN
  for (let v = PAPER_MODE_MIN_BIN; v < 256; v++) {
    if ((histogram[v] ?? 0) > (histogram[modeBin] ?? 0)) modeBin = v
  }
  const raw = Math.round(modeBin * PAPER_MODE_FACTOR)
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, raw))
}

/**
 * Soglia di Otsu. NON è usata per binarizzare (vedi paperModeThreshold): serve solo
 * a calcolare l'indice di separabilità e a documentare nei test perché la scartiamo.
 */
export function otsuThreshold(histogram: ArrayLike<number>): number {
  let total = 0
  let sumAll = 0
  for (let v = 0; v < 256; v++) {
    const c = histogram[v] ?? 0
    total += c
    sumAll += v * c
  }
  if (total === 0) return 0

  let wB = 0
  let sumB = 0
  let best = -1
  let threshold = 0
  for (let t = 0; t < 256; t++) {
    wB += histogram[t] ?? 0
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * (histogram[t] ?? 0)
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/**
 * Separabilità inchiostro/carta: eta di Otsu = sigma_B^2(max) / sigma_T^2, in 0..1.
 * Valori bassi = inchiostro e carta non si distinguono (scansione slavata o sporca).
 */
export function otsuSeparability(histogram: ArrayLike<number>): number {
  let total = 0
  let sumAll = 0
  for (let v = 0; v < 256; v++) {
    const c = histogram[v] ?? 0
    total += c
    sumAll += v * c
  }
  if (total === 0) return 0

  const mean = sumAll / total
  let varTotal = 0
  for (let v = 0; v < 256; v++) varTotal += (histogram[v] ?? 0) * (v - mean) * (v - mean)
  varTotal /= total
  if (varTotal <= 0) return 0

  let wB = 0
  let sumB = 0
  let bestBetween = 0
  for (let t = 0; t < 256; t++) {
    wB += histogram[t] ?? 0
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * (histogram[t] ?? 0)
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    // sigma_B^2 con pesi normalizzati
    const between = (wB / total) * (wF / total) * (mB - mF) * (mB - mF)
    if (between > bestBetween) bestBetween = between
  }
  return Math.min(1, bestBetween / varTotal)
}

// ============================================================================
// Griglie
// ============================================================================

/**
 * Riduce il pixmap in scala di grigi a una griglia di celle CELL_PX x CELL_PX e
 * costruisce nella stessa passata i profili di proiezione riga e colonna.
 *
 * Restituisce null se la vista sui pixel è più corta di stride*height: getPixels()
 * è una vista viva sulla heap WASM e si stacca in silenzio se la heap cresce.
 * Senza questa guardia l'istogramma sarebbe tutto a zero e ogni pagina verrebbe
 * classificata male, senza un solo errore nei log.
 */
export function buildInkGrid(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  stride: number,
  threshold: number,
  cellPx: number
): InkGrid | null {
  if (width <= 0 || height <= 0 || cellPx <= 0) return null
  if (pixels.length < stride * height) return null

  const cols = Math.ceil(width / cellPx)
  const rows = Math.ceil(height / cellPx)
  const cellInk = new Uint16Array(cols * rows)
  const inkMask = new Uint8Array(width * height)
  const rowProfile = new Float64Array(height)
  const colProfile = new Float64Array(width)
  let inkPixels = 0

  for (let y = 0; y < height; y++) {
    const base = y * stride
    const cellRow = ((y / cellPx) | 0) * cols
    let rowCount = 0
    for (let x = 0; x < width; x++) {
      if (pixels[base + x] <= threshold) {
        rowCount++
        colProfile[x] += 1
        cellInk[cellRow + ((x / cellPx) | 0)] += 1
        inkMask[y * width + x] = 1
      }
    }
    rowProfile[y] = rowCount
    inkPixels += rowCount
  }

  const cells = new Uint8Array(cols * rows)
  for (let i = 0; i < cells.length; i++) {
    cells[i] = cellInk[i] >= OCR_CHECK_TUNING.CELL_MIN_INK_PX ? 1 : 0
  }

  const totalPixels = width * height
  return {
    cols,
    rows,
    cellPx,
    width,
    height,
    cells,
    cellInk,
    inkMask,
    rowProfile,
    colProfile,
    inkPixels,
    inkFraction: totalPixels > 0 ? inkPixels / totalPixels : 0
  }
}

/**
 * Dilatazione di 1 cella a 4 vicini. Assorbe gli arrotondamenti sub-cella e lo slop
 * di ~0,2-0,3 em dei font OCR sintetici. Restituisce un nuovo array.
 *
 * Da usare per coverage/lift, MAI per lineAgreement: la dilatazione fonde gli spazi
 * fra parole e falserebbe il conteggio dei run.
 */
export function dilate1(cells: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (cells[i] === 1) {
        out[i] = 1
        continue
      }
      if (c > 0 && cells[i - 1] === 1) { out[i] = 1; continue }
      if (c < cols - 1 && cells[i + 1] === 1) { out[i] = 1; continue }
      if (r > 0 && cells[i - cols] === 1) { out[i] = 1; continue }
      if (r < rows - 1 && cells[i + cols] === 1) { out[i] = 1 }
    }
  }
  return out
}

/** Maschera delle celle che intersecano una regione in pixel. */
export function buildRegionMask(
  clip: PixelRect,
  width: number,
  height: number,
  cellPx: number
): Uint8Array {
  const cols = Math.ceil(width / cellPx)
  const rows = Math.ceil(height / cellPx)
  const mask = new Uint8Array(cols * rows)
  const c0 = Math.max(0, Math.floor(clip.x0 / cellPx))
  const c1 = Math.min(cols - 1, Math.ceil(clip.x1 / cellPx) - 1)
  const r0 = Math.max(0, Math.floor(clip.y0 / cellPx))
  const r1 = Math.min(rows - 1, Math.ceil(clip.y1 / cellPx) - 1)
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1
  }
  return mask
}

/** Griglia attesa dal layer di testo: celle coperte dai bbox di riga, clippati all'immagine. */
export function buildTextGrid(
  boxes: readonly PixelBox[],
  clip: PixelRect,
  width: number,
  height: number,
  cellPx: number
): TextGrid {
  const cols = Math.ceil(width / cellPx)
  const rows = Math.ceil(height / cellPx)
  const cells = new Uint8Array(cols * rows)
  const rowProfile = new Float64Array(height)
  const colProfile = new Float64Array(width)
  const kept: PixelBox[] = []

  for (const box of boxes) {
    const x0 = Math.max(0, Math.max(clip.x0, box.x0))
    const y0 = Math.max(0, Math.max(clip.y0, box.y0))
    const x1 = Math.min(width, Math.min(clip.x1, box.x1))
    const y1 = Math.min(height, Math.min(clip.y1, box.y1))
    if (x1 - x0 < 1 || y1 - y0 < 1) continue

    // I bbox restituiti restano a piena altezza: lineAgreement campiona l'inchiostro
    // sulla banda della riga e tara il gap fra parole sull'altezza del bbox intero.
    kept.push({ x0, y0, x1, y1, words: box.words })

    // Griglia e profili usano invece la sola banda dei glifi (vedi GLYPH_BAND_*).
    const altezzaBbox = y1 - y0
    const gy0 = y0 + altezzaBbox * OCR_CHECK_TUNING.GLYPH_BAND_TOP
    const gy1 = y0 + altezzaBbox * OCR_CHECK_TUNING.GLYPH_BAND_BOTTOM
    if (gy1 - gy0 < 1) continue

    const w = x1 - x0
    const h = gy1 - gy0
    for (let y = Math.floor(gy0); y < Math.ceil(gy1) && y < height; y++) rowProfile[y] += w
    for (let x = Math.floor(x0); x < Math.ceil(x1) && x < width; x++) colProfile[x] += h

    const c0 = Math.floor(x0 / cellPx)
    const c1 = Math.min(cols - 1, Math.ceil(x1 / cellPx) - 1)
    const r0 = Math.floor(gy0 / cellPx)
    const r1 = Math.min(rows - 1, Math.ceil(gy1 / cellPx) - 1)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells[r * cols + c] = 1
    }
  }

  let cellCount = 0
  for (let i = 0; i < cells.length; i++) cellCount += cells[i]

  return { cols, rows, cellPx, cells, rowProfile, colProfile, cellCount, boxes: kept }
}

// ============================================================================
// Metriche di allineamento
// ============================================================================

/** Frazione delle celle-testo che cadono su inchiostro, a shift zero. */
export function gridCoverage(textCells: Uint8Array, inkCells: Uint8Array): number {
  const n = Math.min(textCells.length, inkCells.length)
  let text = 0
  let hit = 0
  for (let i = 0; i < n; i++) {
    if (textCells[i] === 1) {
      text++
      if (inkCells[i] === 1) hit++
    }
  }
  return text > 0 ? hit / text : 0
}

/**
 * Baseline = densità di inchiostro nella regione, cioè la coverage che otterrebbe un
 * piazzamento casuale. Il lift (coverage/baseline) è ciò che evita di dare per buono
 * un layer rotto su pagine molto inchiostrate — tabelle a griglia piena, timbri,
 * scansioni scure — dove coverage ≈ 1 per qualunque shift.
 */
export function liftBaseline(
  inkCells: Uint8Array,
  regionMask: Uint8Array,
  coverage: number
): { baseline: number; lift: number } {
  const n = Math.min(inkCells.length, regionMask.length)
  let region = 0
  let ink = 0
  for (let i = 0; i < n; i++) {
    if (regionMask[i] === 1) {
      region++
      if (inkCells[i] === 1) ink++
    }
  }
  const baseline = region > 0 ? ink / region : 0
  return { baseline, lift: baseline > 0 ? coverage / baseline : 0 }
}

/**
 * Accordo riga per riga fra layer di testo e inchiostro. È la metrica che cattura il
 * caso peggiore: uno scostamento di ESATTAMENTE un'interlinea produce coverage ALTA
 * (il testo cade sull'inchiostro della riga adiacente, che inchiostro ce l'ha) ed è il
 * disallineamento più pericoloso, perché si redige la riga sbagliata. Righe diverse
 * hanno però lunghezze e numero di parole diversi: l'accordo crolla.
 *
 * Va chiamata sulle celle NON dilatate.
 * Restituisce null sotto LINE_AGREEMENT_MIN_LINES righe utili: meglio un'astensione
 * dichiarata di un numero inventato.
 */
export function lineAgreement(
  boxes: readonly PixelBox[],
  inkMask: ArrayLike<number>,
  width: number,
  height: number
): number | null {
  const {
    LINE_GAP_RATIO,
    LINE_GAP_MIN_PX,
    EXTENT_TOL_PX,
    EXTENT_TOL_RATIO,
    RUNS_TOL_ABS,
    RUNS_MIN_RATIO,
    LINE_AGREEMENT_MIN_LINES,
    BAND_SOLID_RATIO
  } = OCR_CHECK_TUNING

  if (inkMask.length < width * height) return null

  let usable = 0
  let agreed = 0
  const colHasInk = new Uint8Array(width)

  for (const box of boxes) {
    const boxW = box.x1 - box.x0
    const boxH = box.y1 - box.y0
    if (box.words < 1 || boxW < 8 || boxH < 2) continue
    usable++

    const y0 = Math.max(0, Math.floor(box.y0))
    const y1 = Math.min(height, Math.ceil(box.y1))
    if (y1 <= y0) continue

    // Profilo colonna dell'inchiostro dentro la banda y della riga, RISTRETTO
    // all'estensione orizzontale della riga stessa (più la tolleranza).
    // Scorrere l'intera larghezza della pagina è sbagliato: in un layout a due
    // colonne la banda y di una riga attraversa anche l'altra colonna, e
    // `first`/`last` finirebbero per descrivere la pagina invece della riga.
    const xPad = Math.round(EXTENT_TOL_PX + EXTENT_TOL_RATIO * boxW)
    const xLo = Math.max(0, Math.floor(box.x0) - xPad)
    const xHi = Math.min(width, Math.ceil(box.x1) + xPad)
    if (xHi <= xLo) continue

    colHasInk.fill(0)
    for (let y = y0; y < y1; y++) {
      const base = y * width
      for (let x = xLo; x < xHi; x++) {
        if (inkMask[base + x] === 1) colHasInk[x] = 1
      }
    }

    // Banda quasi interamente inchiostrata: è un filetto di tabella o un fondo
    // pieno, non testo. La struttura dei run non porta informazione, quindi
    // ci si astiene invece di dichiarare un disaccordo inventato.
    let bandInk = 0
    for (let x = xLo; x < xHi; x++) if (colHasInk[x] === 1) bandInk++
    if (bandInk >= (xHi - xLo) * BAND_SOLID_RATIO) {
      usable--
      continue
    }

    let first = -1
    let last = -1
    let runs = 0
    let gap = 0
    let inRun = false
    const gapPx = Math.max(LINE_GAP_MIN_PX, Math.round(LINE_GAP_RATIO * boxH))

    for (let x = xLo; x < xHi; x++) {
      if (colHasInk[x] === 1) {
        if (first < 0) first = x
        last = x
        if (!inRun) { runs++; inRun = true }
        gap = 0
      } else if (inRun) {
        gap++
        if (gap >= gapPx) inRun = false
      }
    }

    if (first < 0) continue // nessun inchiostro sotto la riga: non accorda

    const tol = EXTENT_TOL_PX + EXTENT_TOL_RATIO * boxW
    const extentOk = Math.abs(first - box.x0) <= tol && Math.abs(last + 1 - box.x1) <= tol

    // I run possono fondersi — a 72 DPI uno spazio di parola è ~3px, sotto la soglia
    // di gap — ma non moltiplicarsi oltre le parole dichiarate.
    const runsMin = Math.max(1, Math.ceil(box.words * RUNS_MIN_RATIO))
    const runsMax = box.words + RUNS_TOL_ABS
    const runsOk = runs >= runsMin && runs <= runsMax

    if (extentOk && runsOk) agreed++
  }

  if (usable < LINE_AGREEMENT_MIN_LINES) return null
  return agreed / usable
}

/**
 * Cross-correlazione normalizzata 1-D. Restituisce il lag che, applicato a `signal`
 * (spostandolo in avanti), lo allinea meglio a `reference`.
 * `subLag` raffina il picco con una parabola sui tre punti attorno all'argmax.
 *
 * Il punteggio è pesato per la frazione di sovrapposizione e, a parità di punteggio,
 * vince il lag più vicino a zero. Senza queste due accortezze un profilo di righe di
 * testo — che è quasi-periodico con periodo pari all'interlinea — fa segnare lo stesso
 * identico punteggio a lag 0, ±1 interlinea, ±2 interlinee..., e l'argmax cade a caso
 * su un multiplo qualsiasi. Preferire lo zero è anche la scelta prudente: l'offset è
 * puramente DIAGNOSTICO e non va mai applicato.
 */
export function crossCorrelate1D(
  reference: ArrayLike<number>,
  signal: ArrayLike<number>,
  maxLag: number
): { lag: number; subLag: number; score: number } {
  const n = Math.min(reference.length, signal.length)
  if (n < 2 || maxLag < 0) return { lag: 0, subLag: 0, score: 0 }
  const lim = Math.min(Math.floor(maxLag), n - 1)

  let meanR = 0
  let meanS = 0
  for (let i = 0; i < n; i++) {
    meanR += reference[i]
    meanS += signal[i]
  }
  meanR /= n
  meanS /= n

  const scores = new Float64Array(2 * lim + 1)
  let bestIdx = lim
  let bestScore = -Infinity
  for (let lag = -lim; lag <= lim; lag++) {
    const from = Math.max(0, lag)
    const to = Math.min(n, n + lag)
    let dot = 0
    let normR = 0
    let normS = 0
    for (let i = from; i < to; i++) {
      const a = reference[i] - meanR
      const b = signal[i - lag] - meanS
      dot += a * b
      normR += a * a
      normS += b * b
    }
    const denom = Math.sqrt(normR * normS)
    const overlap = Math.max(0, to - from)
    const s = denom > 0 ? (dot / denom) * (overlap / n) : 0
    scores[lag + lim] = s
    if (s > bestScore + TIE_EPSILON) {
      bestScore = s
      bestIdx = lag + lim
    } else if (s > bestScore - TIE_EPSILON && Math.abs(lag) < Math.abs(bestIdx - lim)) {
      // Parità di punteggio (profilo periodico): vince il lag più vicino a zero.
      bestScore = Math.max(bestScore, s)
      bestIdx = lag + lim
    }
  }

  const lag = bestIdx - lim
  let subLag = lag
  if (bestIdx > 0 && bestIdx < scores.length - 1) {
    const sm = scores[bestIdx - 1]
    const s0 = scores[bestIdx]
    const sp = scores[bestIdx + 1]
    const denom = sm - 2 * s0 + sp
    if (denom !== 0) {
      const delta = (0.5 * (sm - sp)) / denom
      if (Number.isFinite(delta) && Math.abs(delta) <= 1) subLag = lag + delta
    }
  }

  return { lag, subLag, score: bestScore === -Infinity ? 0 : bestScore }
}

function subProfile(p: ArrayLike<number>, from: number, to: number): Float64Array {
  const out = new Float64Array(Math.max(0, to - from))
  for (let i = 0; i < out.length; i++) out[i] = p[from + i]
  return out
}

/**
 * Errore di scala verticale. Il difetto dominante nella realtà non è una traslazione
 * ma un errore di scala — layer costruito a 300 DPI su pagina dimensionata per 200, o
 * confusione MediaBox/CropBox — che produce dy proporzionale a y: perfetto in cima e
 * 10pt fuori in fondo. Si correla il profilo riga separatamente sul terzo superiore e
 * sul terzo inferiore e si ricava la scala da una retta a due punti.
 */
export function fitScaleY(
  inkRowProfile: ArrayLike<number>,
  textRowProfile: ArrayLike<number>,
  maxLag: number
): { scaleY: number; lagTop: number; lagBottom: number } {
  const neutro = { scaleY: 1, lagTop: 0, lagBottom: 0 }
  const n = Math.min(inkRowProfile.length, textRowProfile.length)

  // Si misura solo sulla fascia che contiene davvero testo. Il terzo inferiore di una
  // pagina è in buona parte margine bianco: correlarlo restituisce lag di puro rumore
  // (misurato su un A4: massa di testo 8341 in basso contro 31029 in alto, lag -4 su
  // una pagina perfettamente allineata) e quel rumore diventa un falso scale-mismatch.
  let first = -1
  let last = -1
  let massaTotale = 0
  for (let i = 0; i < n; i++) {
    const v = textRowProfile[i]
    if (v > 0) {
      if (first < 0) first = i
      last = i
      massaTotale += v
    }
  }
  if (first < 0 || massaTotale <= 0) return neutro

  const span = last - first + 1
  const third = Math.floor(span / 3)
  if (third < 8) return neutro

  const topFrom = first
  const topTo = first + third
  const botFrom = last + 1 - third
  const botTo = last + 1

  let massaTop = 0
  let massaBot = 0
  for (let i = topFrom; i < topTo; i++) massaTop += textRowProfile[i]
  for (let i = botFrom; i < botTo; i++) massaBot += textRowProfile[i]
  const minima = massaTotale * OCR_CHECK_TUNING.BAND_MIN_MASS_RATIO
  // Bande troppo sbilanciate: ci si astiene invece di riportare una scala inventata.
  if (massaTop < minima || massaBot < minima) return neutro

  const lim = Math.min(Math.floor(maxLag), third - 1)
  const top = crossCorrelate1D(
    subProfile(inkRowProfile, topFrom, topTo),
    subProfile(textRowProfile, topFrom, topTo),
    lim
  )
  const bottom = crossCorrelate1D(
    subProfile(inkRowProfile, botFrom, botTo),
    subProfile(textRowProfile, botFrom, botTo),
    lim
  )

  const yTop = topFrom + third / 2
  const yBottom = botFrom + third / 2
  const distanza = yBottom - yTop

  // Braccio verticale insufficiente: ci si astiene.
  // Lo scarto di scala è (lagBot - lagTop) / distanza, quindi UN SOLO pixel di
  // rumore sul lag si traduce in un errore di scala pari a 1/distanza. Perché
  // quel rumore resti sotto metà della soglia di giudizio serve
  //     distanza >= 2 / SCALE_TOLERANCE
  // cioè ~400px a 72 DPI con tolleranza 0,005. Una pagina piena di A4 (842px)
  // ci arriva; una pagina di coda con poche righe no — ed è il caso che
  // produceva un falso 'scale-mismatch' su pagine finali perfettamente sane,
  // che quasi ogni documento reale possiede.
  const distanzaMinima = 2 / OCR_CHECK_TUNING.SCALE_TOLERANCE
  if (distanza < distanzaMinima) return neutro

  const slope = (bottom.subLag - top.subLag) / distanza
  return { scaleY: 1 + slope, lagTop: top.subLag, lagBottom: bottom.subLag }
}

/**
 * Inclinazione in gradi, per massimizzazione della varianza del profilo di proiezione.
 * Non ruota la bitmap: ricalcola il profilo *a un angolo* con indicizzazione shear.
 * Positivo = righe che scendono verso destra (y cresce con x).
 *
 * Lavora sui conteggi per cella (cellInk), cioè l'immagine ridotta a 1/4 per lato:
 * ~34k campioni x 41 angoli ≈ 1,4 M operazioni.
 */
export function estimateSkew(
  cellInk: ArrayLike<number>,
  cols: number,
  rows: number,
  maxDeg: number = OCR_CHECK_TUNING.SKEW_MAX_DEG,
  stepDeg: number = OCR_CHECK_TUNING.SKEW_STEP_DEG
): number {
  if (cols <= 1 || rows <= 1 || stepDeg <= 0) return 0

  // Estrai una sola volta le celle non vuote: nelle scansioni sono pochi punti percento.
  const xs: number[] = []
  const ys: number[] = []
  const vs: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = cellInk[r * cols + c]
      if (v > 0) { xs.push(c); ys.push(r); vs.push(v) }
    }
  }
  if (xs.length < 16) return 0

  const tanMax = Math.tan((maxDeg * Math.PI) / 180)
  const offset = Math.ceil(cols * Math.abs(tanMax)) + 1
  const len = rows + 2 * offset
  const profile = new Float64Array(len)

  let bestAngle = 0
  let bestVariance = -Infinity
  const steps = Math.round((2 * maxDeg) / stepDeg)

  for (let s = 0; s <= steps; s++) {
    const angle = -maxDeg + s * stepDeg
    const t = Math.tan((angle * Math.PI) / 180)
    profile.fill(0)
    let total = 0
    for (let i = 0; i < xs.length; i++) {
      const idx = Math.round(ys[i] - xs[i] * t) + offset
      if (idx >= 0 && idx < len) {
        profile[idx] += vs[i]
        total += vs[i]
      }
    }
    if (total <= 0) continue
    const mean = total / len
    let variance = 0
    for (let i = 0; i < len; i++) {
      const d = profile[i] - mean
      variance += d * d
    }
    variance /= len
    if (variance > bestVariance) {
      bestVariance = variance
      bestAngle = angle
    }
  }

  return bestAngle
}

/**
 * Varianza del laplaciano normalizzata per la varianza dell'immagine.
 *
 * SEGNALE DEBOLE: le soglie che circolano vengono da blog su foto naturali e le
 * metriche generiche non predicono l'errore OCR. Non deve MAI da solo generare
 * un avviso — vedi classifyImageQuality.
 */
export function laplacianVariance(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  stride: number
): number {
  if (width < 3 || height < 3) return 0
  if (pixels.length < stride * height) return 0

  let sumLap = 0
  let sumLapSq = 0
  let sumImg = 0
  let sumImgSq = 0
  let count = 0

  for (let y = 1; y < height - 1; y++) {
    const base = y * stride
    for (let x = 1; x < width - 1; x++) {
      const p = pixels[base + x]
      const lap =
        4 * p -
        pixels[base - stride + x] -
        pixels[base + stride + x] -
        pixels[base + x - 1] -
        pixels[base + x + 1]
      sumLap += lap
      sumLapSq += lap * lap
      sumImg += p
      sumImgSq += p * p
      count++
    }
  }
  if (count === 0) return 0

  const varLap = sumLapSq / count - (sumLap / count) ** 2
  const varImg = sumImgSq / count - (sumImg / count) ** 2
  if (varImg <= 0) return 0
  return Math.max(0, varLap / varImg)
}

// ============================================================================
// Verdetti
// ============================================================================

/**
 * Verdetto di pagina. `aligned` se e solo se tutte le condizioni reggono.
 *
 * Ordine delle reason, dalla più specifica alla più generica:
 * scale-mismatch → offset-too-large → low-line-agreement → low-coverage → low-lift.
 * Nota: sotto uno scostamento di esattamente un'interlinea la cross-correlazione
 * riporta spesso lag ≈ 0 (il profilo del testo corrente è quasi-periodico), quindi
 * l'unica metrica che se ne accorge è lineAgreement.
 */
export function classifyPage(m: PageJudgement): { verdict: OcrLayerVerdict; reason: OcrPageReason } {
  const { COVERAGE_MIN, LIFT_MIN, LINE_AGREEMENT_MIN, SCALE_TOLERANCE, OFFSET_MAX_PT } =
    OCR_CHECK_TUNING

  if (Math.abs(m.scaleY - 1) > SCALE_TOLERANCE) {
    return { verdict: 'misaligned', reason: 'scale-mismatch' }
  }
  if (Math.abs(m.offsetYPt) > OFFSET_MAX_PT || Math.abs(m.offsetXPt) > OFFSET_MAX_PT) {
    return { verdict: 'misaligned', reason: 'offset-too-large' }
  }
  if (m.lineAgreement !== null && m.lineAgreement < LINE_AGREEMENT_MIN) {
    return { verdict: 'misaligned', reason: 'low-line-agreement' }
  }
  if (m.coverage < COVERAGE_MIN) {
    return { verdict: 'misaligned', reason: 'low-coverage' }
  }
  if (m.lift < LIFT_MIN) {
    return { verdict: 'misaligned', reason: 'low-lift' }
  }
  return { verdict: 'aligned', reason: 'ok' }
}

/** Qualità del raster sorgente. blurScore non genera mai da solo un avviso. */
export function classifyImageQuality(m: ImageQualityMetrics): {
  verdict: ImageQualityVerdict
  reasons: ImageQualityReason[]
} {
  const {
    DPI_POOR,
    DPI_MARGINAL,
    X_HEIGHT_POOR,
    X_HEIGHT_MARGINAL,
    SEPARABILITY_MIN,
    SKEW_WARN_DEG,
    SKEW_BAD_DEG,
    BLUR_MIN
  } = OCR_CHECK_TUNING

  const reasons: ImageQualityReason[] = []
  let verdict: ImageQualityVerdict = 'good'
  const worsen = (v: ImageQualityVerdict): void => {
    if (v === 'poor' || (v === 'marginal' && verdict === 'good')) verdict = v
  }

  if (m.nativeDpi !== null) {
    if (m.nativeDpi < DPI_POOR) {
      reasons.push('very-low-native-dpi')
      worsen('poor')
    } else if (m.nativeDpi < DPI_MARGINAL) {
      reasons.push('low-native-dpi')
      worsen('marginal')
    }
  }

  if (m.xHeightPx !== null) {
    if (m.xHeightPx < X_HEIGHT_POOR) {
      reasons.push('very-small-x-height')
      worsen('poor')
    } else if (m.xHeightPx < X_HEIGHT_MARGINAL) {
      reasons.push('small-x-height')
      worsen('marginal')
    }
  }

  if (m.separability < SEPARABILITY_MIN) {
    reasons.push('low-separability')
    worsen('marginal')
  }

  const skew = Math.abs(m.skewDeg)
  if (skew > SKEW_BAD_DEG) {
    reasons.push('very-skewed')
    worsen('poor')
  } else if (skew > SKEW_WARN_DEG) {
    reasons.push('skewed')
    worsen('marginal')
  }

  // SEGNALE DEBOLE: si annota solo se il verdetto è già compromesso per altro.
  if (verdict !== 'good' && m.blurScore < BLUR_MIN) reasons.push('possibly-blurred')

  return { verdict, reasons }
}

/** Aggregazione fail-closed: la maggioranza non e' una garanzia di sicurezza. */
export function aggregatePages(pages: readonly OcrPageMetrics[]): OcrLayerVerdict {
  const relevant = pages.filter((p) => p.reason !== 'not-raster-page')
  if (relevant.length === 0) return 'inconclusive'
  if (relevant.some((p) => p.verdict === 'misaligned')) return 'misaligned'

  const aligned = relevant.filter((p) => p.verdict === 'aligned').length
  const noTextLayer = relevant.some((p) => p.reason === 'no-text-layer')
  if (aligned > 0 && noTextLayer) return 'misaligned'
  if (relevant.every((p) => p.verdict === 'aligned')) return 'aligned'
  return 'inconclusive'
}

function nullableMetrics(metrics: OcrPageMetrics): NullablePageQualityMetrics {
  if (metrics.verdict === 'inconclusive') {
    return {
      coverage: null,
      lift: null,
      lineAgreement: null,
      scaleY: null,
      offsetXPt: null,
      offsetYPt: null
    }
  }
  return {
    coverage: metrics.coverage,
    lift: metrics.lift,
    lineAgreement: metrics.lineAgreement,
    scaleY: metrics.scaleY,
    offsetXPt: metrics.offsetXPt,
    offsetYPt: metrics.offsetYPt
  }
}

/** Costruisce il routing del documento esclusivamente dagli outcome per pagina. */
export function deriveDocumentSafety(
  pageCount: number,
  pages: readonly PdfPageQualityOutcome[],
  diagnosticPageNumbers: readonly number[] = []
): PdfDocumentSafety {
  const ordered = [...pages].sort((a, b) => a.page - b.page)
  const rasterPages = ordered.filter(
    (page) => page.layerKind === 'scan-with-text' || page.layerKind === 'scan-no-text'
  )
  return {
    pageCount,
    routing: rasterPages.length > 0 ? 'flattened-scan' : 'digital',
    allPagesAnalyzed:
      ordered.length === pageCount &&
      ordered.every((page, index) => page.page === index + 1),
    hasPageErrors: ordered.some((page) => page.status === 'page-error'),
    existingTextLayerUsable:
      rasterPages.length > 0 &&
      rasterPages.every((page) => page.status === 'scan-aligned' && page.existingTextLayerUsable),
    pages: ordered,
    diagnosticPageNumbers: [...diagnosticPageNumbers]
  }
}

// ============================================================================
// Parsing dell'output di StructuredText.asJSON
// ============================================================================

const JsonBBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number()
})

const JsonLineSchema = z.object({
  bbox: JsonBBoxSchema,
  font: z.object({ name: z.string().optional(), size: z.number().optional() }).optional(),
  text: z.string().optional()
})

const JsonBlockSchema = z.object({
  type: z.string(),
  bbox: JsonBBoxSchema,
  lines: z.array(JsonLineSchema).optional()
})

const StructuredTextJsonSchema = z.object({ blocks: z.array(JsonBlockSchema) })

/** Conteggio di parole. Il testo non esce mai da qui. */
function countWords(text: string | undefined): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Indici delle pagine da campionare: prima, ultima, e le intermedie distribuite. */
export function samplePageIndices(pageCount: number, maxPages: number): number[] {
  if (pageCount <= 0) return []
  const limit = Math.max(1, Math.min(maxPages, pageCount))
  if (pageCount <= limit) return Array.from({ length: pageCount }, (_, i) => i)
  const picked = new Set<number>([0, pageCount - 1])
  const inner = limit - 2
  for (let k = 1; k <= inner; k++) {
    picked.add(Math.round((k * (pageCount - 1)) / (inner + 1)))
  }
  return [...picked].sort((a, b) => a - b).slice(0, limit)
}

// ============================================================================
// Analisi di una pagina
// ============================================================================

/** Tipo del default export di mupdf (il namespace del modulo è più ampio). */
type MuPdfModule = (typeof import('mupdf'))['default']

interface PageOutcome {
  metrics: OcrPageMetrics
  layerKind: PdfLayerKind
  /** null quando la pagina non è arrivata alla fase di misura. */
  image: ImageQualityMetrics | null
  fontName: string | null
}

function toSafetyOutcome(outcome: PageOutcome): PdfPageQualityOutcome {
  const { metrics, layerKind, image } = outcome
  let status: PdfPageSafetyStatus
  if (metrics.reason === 'page-error') status = 'page-error'
  else if (layerKind === 'digital') status = 'digital'
  else if (layerKind === 'scan-with-text' && metrics.verdict === 'aligned') status = 'scan-aligned'
  else status = 'scan-untrusted'

  return {
    page: metrics.page,
    status,
    layerKind,
    existingTextLayerUsable: status === 'scan-aligned',
    reason: metrics.reason,
    metrics: nullableMetrics(metrics),
    imageMetrics: image
  }
}

function errorSafetyOutcome(page: number): PdfPageQualityOutcome {
  return {
    page,
    status: 'page-error',
    layerKind: null,
    existingTextLayerUsable: false,
    reason: 'page-error',
    metrics: {
      coverage: null,
      lift: null,
      lineAgreement: null,
      scaleY: null,
      offsetXPt: null,
      offsetYPt: null
    },
    imageMetrics: null
  }
}

function emptyPage(page: number, verdict: OcrLayerVerdict, reason: OcrPageReason): OcrPageMetrics {
  return {
    page,
    verdict,
    reason,
    coverage: 0,
    lift: 0,
    lineAgreement: null,
    scaleY: 1,
    offsetXPt: 0,
    offsetYPt: 0
  }
}

function analyzePage(
  mupdf: MuPdfModule,
  page: import('mupdf').PDFPage,
  pageNumber: number,
  /** Accumulatore del testo di riga per il punteggio linguistico.
   *  Resta in memoria nel main process e non entra MAI nel report né nei log. */
  textSink: string[]
): PageOutcome {
  const { RENDER_DPI, CELL_PX, IMAGE_AREA_MIN_RATIO, CORR_MAX_LAG_PX } = OCR_CHECK_TUNING
  const scale = RENDER_DPI / 72

  // --- 1. Geometria del testo. Tutto PRIMA del render: getPixels() restituisce una
  //        vista viva sulla heap WASM e qualsiasi allocazione MuPDF successiva la stacca.
  const walkLines: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  const imageBlocks: Array<{ rect: import('mupdf').Rect; pxWidth: number; pxHeight: number }> = []
  const jsonLines: Array<{ x: number; y: number; w: number; h: number; words: number }> = []
  let fontName: string | null = null

  const stext = page.toStructuredText('preserve-images')
  try {
    // Si omette onChar di proposito: walk() protegge il ciclo caratteri con
    // `if (walker.onChar)`, quindi MuPDF non tocca i glifi (~3000 keep_font per pagina).
    stext.walk({
      beginLine(bbox) {
        walkLines.push({ x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] })
      },
      onImageBlock(bbox, _transform, image) {
        imageBlocks.push({ rect: bbox, pxWidth: image.getWidth(), pxHeight: image.getHeight() })
      }
    })

    // Le coordinate di asJSON sono troncate a intero: si passa dpi/72.
    const parsed = StructuredTextJsonSchema.safeParse(JSON.parse(stext.asJSON(scale)))
    if (parsed.success) {
      const fontCount = new Map<string, number>()
      for (const block of parsed.data.blocks) {
        if (block.type !== 'text' || !block.lines) continue
        for (const line of block.lines) {
          jsonLines.push({
            x: line.bbox.x,
            y: line.bbox.y,
            w: line.bbox.w,
            h: line.bbox.h,
            words: countWords(line.text)
          })
          if (line.text) textSink.push(line.text)
          const name = line.font?.name
          if (name) fontCount.set(name, (fontCount.get(name) ?? 0) + 1)
        }
      }
      let best = 0
      for (const [name, count] of fontCount) {
        // Il GlyphLessFont di Tesseract è la firma del sandwich: ha priorità.
        if (name.toLowerCase().includes('glyphless')) { fontName = name; break }
        if (count > best) { best = count; fontName = name }
      }
    } else {
      log.warn('ocrLayerCheck: schema asJSON non riconosciuto', { page: pageNumber })
    }
  } finally {
    stext.destroy()
  }

  const bounds = page.getBounds()
  const cropW = bounds[2] - bounds[0]
  const cropH = bounds[3] - bounds[1]
  const cropArea = cropW * cropH

  // --- 2. Gate: la pagina è una scansione con sopra del testo?
  let imageArea = 0
  let imgX0 = Infinity
  let imgY0 = Infinity
  let imgX1 = -Infinity
  let imgY1 = -Infinity
  for (const blk of imageBlocks) {
    const x0 = Math.max(bounds[0], blk.rect[0])
    const y0 = Math.max(bounds[1], blk.rect[1])
    const x1 = Math.min(bounds[2], blk.rect[2])
    const y1 = Math.min(bounds[3], blk.rect[3])
    if (x1 <= x0 || y1 <= y0) continue
    imageArea += (x1 - x0) * (y1 - y0)
    imgX0 = Math.min(imgX0, x0)
    imgY0 = Math.min(imgY0, y0)
    imgX1 = Math.max(imgX1, x1)
    imgY1 = Math.max(imgY1, y1)
  }
  const imageRatio = cropArea > 0 ? Math.min(1, imageArea / cropArea) : 0
  const lineCount = Math.max(walkLines.length, jsonLines.length)

  if (imageRatio < IMAGE_AREA_MIN_RATIO) {
    return {
      metrics: emptyPage(pageNumber, 'inconclusive', 'not-raster-page'),
      layerKind: 'digital',
      image: null,
      fontName
    }
  }
  const rasterLayerKind: PdfLayerKind = lineCount === 0 ? 'scan-no-text' : 'scan-with-text'

  // DPI nativo del raster incorporato, non quello di rendering.
  const dpiSamples: number[] = []
  for (const blk of imageBlocks) {
    const wPt = blk.rect[2] - blk.rect[0]
    const hPt = blk.rect[3] - blk.rect[1]
    // La radice del rapporto fra aree è invariante rispetto a rotazioni di
    // 90°: associare pxWidth alla sola larghezza del bbox raddoppiava il DPI
    // per raster rettangolari ruotati.
    if (wPt > 1 && hPt > 1 && blk.pxWidth > 0 && blk.pxHeight > 0) {
      dpiSamples.push(Math.sqrt((blk.pxWidth * blk.pxHeight) / (wPt * hPt)) * 72)
    }
  }
  const measuredNativeDpi = median(dpiSamples)
  // Le dimensioni pagina in punti sono decimali: un 150 DPI nominale può
  // risultare 149,999999 e cadere per errore nella classe inferiore.
  const nativeDpi = measuredNativeDpi === null ? null : Math.round(measuredNativeDpi)

  // Bbox di riga in pixel. Si preferiscono i bbox float della walk; se i due
  // elenchi non combaciano si ripiega sui bbox (troncati) di asJSON.
  const paired = walkLines.length === jsonLines.length
  const boxes: PixelBox[] = []
  const lineHeightsPt: number[] = []
  for (let i = 0; i < lineCount; i++) {
    const words = jsonLines[i]?.words ?? 1
    let x0: number
    let y0: number
    let x1: number
    let y1: number
    if (paired) {
      const l = walkLines[i]
      x0 = l.x0 * scale
      y0 = l.y0 * scale
      x1 = l.x1 * scale
      y1 = l.y1 * scale
      lineHeightsPt.push(l.y1 - l.y0)
    } else {
      const l = jsonLines[i]
      if (!l) continue
      x0 = l.x
      y0 = l.y
      x1 = l.x + l.w
      y1 = l.y + l.h
      lineHeightsPt.push(l.h / scale)
    }
    boxes.push({ x0, y0, x1, y1, words })
  }

  // --- 3. Render a 72 DPI.
  const renderMatrix = mupdf.Matrix.scale(scale, scale)
  const pixmap = renderWithinPixelBudget(
    page.getBounds(),
    renderMatrix as AffineMatrix,
    () => page.toPixmap(renderMatrix, mupdf.ColorSpace.DeviceGray, false, false),
  )
  let grid: InkGrid | null = null
  let threshold = 0
  let separability = 0
  let blurScore = 0
  let originX = 0
  let originY = 0
  let detached = false

  try {
    const w = pixmap.getWidth()
    const h = pixmap.getHeight()
    const stride = pixmap.getStride()
    originX = pixmap.getX()
    originY = pixmap.getY()
    const pixels = pixmap.getPixels()

    // Da qui alla fine della riduzione a griglia: NESSUNA chiamata MuPDF.
    if (pixels.length < stride * h) {
      detached = true
    } else {
      const histogram = new Float64Array(256)
      for (let y = 0; y < h; y++) {
        const base = y * stride
        for (let x = 0; x < w; x++) histogram[pixels[base + x]] += 1
      }
      threshold = paperModeThreshold(histogram)
      separability = otsuSeparability(histogram)
      grid = buildInkGrid(pixels, w, h, stride, threshold, CELL_PX)
      blurScore = laplacianVariance(pixels, w, h, stride)
    }
  } finally {
    pixmap.destroy()
  }

  if (detached || !grid) {
    return {
      metrics: emptyPage(pageNumber, 'inconclusive', 'pixel-view-detached'),
      layerKind: rasterLayerKind,
      image: null,
      fontName
    }
  }

  const skewDeg = estimateSkew(grid.cellInk, grid.cols, grid.rows)
  const medianLineHeightPt = median(lineHeightsPt)
  const xHeightPx =
    medianLineHeightPt !== null && nativeDpi !== null
      ? medianLineHeightPt * (nativeDpi / 72) * OCR_CHECK_TUNING.X_HEIGHT_RATIO
      : null
  const imageMetrics: ImageQualityMetrics = {
    nativeDpi,
    xHeightPx,
    separability,
    skewDeg,
    blurScore
  }

  // Anche una scansione senza layer di testo deve riportare il DPI nativo e
  // la qualità del raster: è proprio il caso che passerà all'OCR interno.
  if (lineCount === 0) {
    return {
      metrics: emptyPage(pageNumber, 'inconclusive', 'no-text-layer'),
      layerKind: 'scan-no-text',
      image: imageMetrics,
      fontName
    }
  }

  if (
    grid.inkFraction < OCR_CHECK_TUNING.INK_FRACTION_MIN ||
    grid.inkFraction > OCR_CHECK_TUNING.INK_FRACTION_MAX
  ) {
    const reason: OcrPageReason =
      grid.inkFraction < OCR_CHECK_TUNING.INK_FRACTION_MIN ? 'blank-page' : 'dark-page'
    return {
      metrics: emptyPage(pageNumber, 'inconclusive', reason),
      layerKind: 'scan-with-text',
      image: imageMetrics,
      fontName
    }
  }

  // Mappatura punto → pixel: px = pt * scale - pixmap.getX()
  const shifted: PixelBox[] = boxes.map((b) => ({
    x0: b.x0 - originX,
    y0: b.y0 - originY,
    x1: b.x1 - originX,
    y1: b.y1 - originY,
    words: b.words
  }))
  const clip: PixelRect = {
    x0: (Number.isFinite(imgX0) ? imgX0 : bounds[0]) * scale - originX,
    y0: (Number.isFinite(imgY0) ? imgY0 : bounds[1]) * scale - originY,
    x1: (Number.isFinite(imgX1) ? imgX1 : bounds[2]) * scale - originX,
    y1: (Number.isFinite(imgY1) ? imgY1 : bounds[3]) * scale - originY
  }

  const textGrid = buildTextGrid(shifted, clip, grid.width, grid.height, CELL_PX)
  if (textGrid.cellCount < OCR_CHECK_TUNING.MIN_TEXT_CELLS) {
    return {
      metrics: emptyPage(pageNumber, 'inconclusive', 'too-few-text-cells'),
      layerKind: 'scan-with-text',
      image: imageMetrics,
      fontName
    }
  }

  const dilated = dilate1(grid.cells, grid.cols, grid.rows)
  const coverage = gridCoverage(textGrid.cells, dilated)
  const regionMask = buildRegionMask(clip, grid.width, grid.height, CELL_PX)
  const { baseline, lift } = liftBaseline(dilated, regionMask, coverage)

  if (baseline > OCR_CHECK_TUNING.BASELINE_MAX) {
    return {
      metrics: emptyPage(pageNumber, 'inconclusive', 'ink-baseline-too-high'),
      layerKind: 'scan-with-text',
      image: imageMetrics,
      fontName
    }
  }

  // lineAgreement a risoluzione piena: a 4px per cella gli spazi fra parole spariscono.
  const agreement = lineAgreement(textGrid.boxes, grid.inkMask, grid.width, grid.height)
  const dy = crossCorrelate1D(grid.rowProfile, textGrid.rowProfile, CORR_MAX_LAG_PX)
  const dx = crossCorrelate1D(grid.colProfile, textGrid.colProfile, CORR_MAX_LAG_PX)
  const { scaleY } = fitScaleY(grid.rowProfile, textGrid.rowProfile, CORR_MAX_LAG_PX)

  const judgement: PageJudgement = {
    coverage,
    lift,
    lineAgreement: agreement,
    scaleY,
    // DIAGNOSTICI: non vanno MAI applicati. Su testo corrente la coverage in funzione
    // di dy è quasi-periodica con periodo pari all'interlinea, quindi uno scostamento
    // di esattamente una riga ha lo stesso punteggio di zero: un argmax riporterebbe
    // con sicurezza un offset che, applicato, sposta le redazioni sulla riga sbagliata.
    offsetXPt: dx.lag / scale,
    offsetYPt: dy.lag / scale
  }
  const { verdict, reason } = classifyPage(judgement)

  return {
    metrics: { page: pageNumber, verdict, reason, ...judgement },
    layerKind: 'scan-with-text',
    image: imageMetrics,
    fontName
  }
}

// ============================================================================
// API pubblica
// ============================================================================

function emptyReport(elapsedMs: number, layerKind: PdfLayerKind = 'digital'): OcrLayerReport {
  const imageMetrics: ImageQualityMetrics = {
    nativeDpi: null,
    xHeightPx: null,
    separability: 0,
    skewDeg: 0,
    blurScore: 0
  }
  return {
    layerKind,
    verdict: 'inconclusive',
    pagesSampled: 0,
    pagesMisaligned: 0,
    pagesInconclusive: 0,
    maxOffsetMm: 0,
    producerFont: null,
    pages: [],
    // TODO(E2): textQuality / textQualityReasons sono di competenza di textQuality.ts.
    textQuality: 'good',
    textQualityReasons: [],
    imageQuality: 'good',
    imageQualityReasons: [],
    imageMetrics,
    suggestedOcrDpi: OCR_CHECK_TUNING.OCR_DPI_DEFAULT,
    elapsedMs
  }
}

/**
 * Analizza un PDF per stabilire se è una scansione con layer di testo OCR e, in tal
 * caso, se quel layer è allineato ai pixel. Non fallisce mai in modo fatale: un PDF
 * cifrato o corrotto produce un verdetto 'inconclusive'.
 */
async function analyzeOcrLayerInternal(
  filePath: string,
  opts?: { maxPages?: number },
  safetySink?: PdfPageQualityOutcome[]
): Promise<OcrLayerReport> {
  const started = Date.now()
  // maxPages governa soltanto l'eventuale campione diagnostico esposto dalla
  // nuova API analyzePdfQuality. Il routing analizza sempre tutte le pagine.
  void opts

  try {
    // Lazy loading: mupdf è pesante, si carica solo quando serve (CLAUDE.md, Livello 2).
    const { readFile } = await import('fs/promises')
    const mupdf = (await import('mupdf')).default

    const fileBuffer = await readFile(filePath)
    const bytes = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength)

    let doc: import('mupdf').PDFDocument
    try {
      doc = new mupdf.PDFDocument(bytes)
    } catch (err) {
      log.warn('ocrLayerCheck: PDF non apribile', {
        stage: 'ocr',
        errorCode: safeErrorCode(err),
      })
      return emptyReport(Date.now() - started)
    }

    const pageCount = doc.countPages()
    const indices = Array.from({ length: pageCount }, (_, index) => index)

    const pages: OcrPageMetrics[] = []
    // Testo delle pagine campionate, solo per il punteggio linguistico.
    // Non viene mai loggato né inserito nel report (CLAUDE.md §6).
    const textSink: string[] = []
    const imageSamples: ImageQualityMetrics[] = []
    const kinds: PdfLayerKind[] = []
    const fonts: string[] = []

    for (const index of indices) {
      try {
        const outcome = analyzePage(mupdf, doc.loadPage(index), index + 1, textSink)
        pages.push(outcome.metrics)
        safetySink?.push(toSafetyOutcome(outcome))
        kinds.push(outcome.layerKind)
        if (outcome.image) imageSamples.push(outcome.image)
        if (outcome.fontName) fonts.push(outcome.fontName)
      } catch (err) {
        log.warn('ocrLayerCheck: errore su pagina', {
          page: index + 1,
          errorCode: safeErrorCode(err),
        })
        pages.push(emptyPage(index + 1, 'inconclusive', 'page-error'))
        safetySink?.push(errorSafetyOutcome(index + 1))
      }
    }

    const layerKind: PdfLayerKind = kinds.includes('scan-with-text')
      ? 'scan-with-text'
      : kinds.includes('scan-no-text')
        ? 'scan-no-text'
        : 'digital'

    const verdict = aggregatePages(pages)
    const pagesMisaligned = pages.filter((p) => p.verdict === 'misaligned').length
    const pagesInconclusive = pages.filter((p) => p.verdict === 'inconclusive').length

    let maxOffsetPt = 0
    for (const p of pages) {
      if (p.verdict === 'inconclusive') continue
      maxOffsetPt = Math.max(maxOffsetPt, Math.abs(p.offsetXPt), Math.abs(p.offsetYPt))
    }

    const dpiValues = imageSamples.map((m) => m.nativeDpi).filter((v): v is number => v !== null)
    const xhValues = imageSamples.map((m) => m.xHeightPx).filter((v): v is number => v !== null)
    const imageMetrics: ImageQualityMetrics = {
      nativeDpi: median(dpiValues),
      xHeightPx: median(xhValues),
      separability: median(imageSamples.map((m) => m.separability)) ?? 0,
      // Per lo skew interessa la pagina peggiore, non quella tipica.
      skewDeg: imageSamples.reduce(
        (worst, m) => (Math.abs(m.skewDeg) > Math.abs(worst) ? m.skewDeg : worst),
        0
      ),
      blurScore: median(imageSamples.map((m) => m.blurScore)) ?? 0
    }
    // Nessuna pagina campionata ha prodotto misure sull'immagine (per esempio
    // perché il rendering diagnostico è fallito). In quel caso separability e blurScore valgono 0 perche' non
    // sono stati misurati, non perche' siano risultati pessimi: darli in pasto a
    // classifyImageQuality produrrebbe un 'marginal' con motivi 'low-separability'
    // e 'possibly-blurred' inventati di sana pianta. Ci si astiene, come fa
    // scoreTextQuality con un campione troppo piccolo.
    const { verdict: imageQuality, reasons: imageQualityReasons } =
      imageSamples.length > 0
        ? classifyImageQuality(imageMetrics)
        : { verdict: 'good' as ImageQualityVerdict, reasons: [] as ImageQualityReason[] }

    const producerFont =
      fonts.find((f) => f.toLowerCase().includes('glyphless')) ?? fonts[0] ?? null

    // Qualità linguistica sul testo delle pagine campionate. Il verdetto e le
    // etichette escono; il testo no — resta in questa variabile locale.
    const qualitaTesto = scoreTextQuality(textSink.join(' '))

    const report: OcrLayerReport = {
      layerKind,
      verdict,
      pagesSampled: pages.length,
      pagesMisaligned,
      pagesInconclusive,
      maxOffsetMm: maxOffsetPt * PT_PER_MM,
      producerFont,
      pages,
      textQuality: qualitaTesto.verdict,
      textQualityReasons: qualitaTesto.reasons,
      imageQuality,
      imageQualityReasons,
      imageMetrics,
      suggestedOcrDpi: Math.round(
        clamp(
          imageMetrics.nativeDpi ?? OCR_CHECK_TUNING.OCR_DPI_DEFAULT,
          OCR_CHECK_TUNING.OCR_DPI_MIN,
          OCR_CHECK_TUNING.OCR_DPI_MAX
        )
      ),
      elapsedMs: Date.now() - started
    }

    log.info('ocrLayerCheck completato', {
      layerKind: report.layerKind,
      verdict: report.verdict,
      pagesSampled: report.pagesSampled,
      pagesMisaligned: report.pagesMisaligned,
      pagesInconclusive: report.pagesInconclusive,
      maxOffsetMm: Math.round(report.maxOffsetMm * 100) / 100,
      imageQuality: report.imageQuality,
      nativeDpi: imageMetrics.nativeDpi === null ? null : Math.round(imageMetrics.nativeDpi),
      elapsedMs: report.elapsedMs
    })

    return report
  } catch (err) {
    log.warn('ocrLayerCheck: analisi fallita', {
      stage: 'ocr',
      errorCode: safeErrorCode(err),
    })
    return emptyReport(Date.now() - started)
  }
}

/** Report IPC compatibile; la decisione e' comunque calcolata su tutte le pagine. */
export async function analyzeOcrLayer(
  filePath: string,
  opts?: { maxPages?: number }
): Promise<OcrLayerReport> {
  return analyzeOcrLayerInternal(filePath, opts)
}

/**
 * API interna per il generatore: outcome esplicito per ogni pagina e routing
 * deterministico. `maxPages` seleziona solo i numeri mostrabili in diagnostica;
 * non riduce mai le pagine analizzate.
 */
export async function analyzePdfQuality(
  filePath: string,
  opts?: { maxPages?: number }
): Promise<PdfQualityAnalysis> {
  const pages: PdfPageQualityOutcome[] = []
  const report = await analyzeOcrLayerInternal(filePath, opts, pages)
  const maxPages = Math.max(1, opts?.maxPages ?? OCR_CHECK_TUNING.MAX_PAGES)
  const diagnosticPageNumbers = samplePageIndices(report.pages.length, maxPages).map(
    (index) => index + 1
  )
  return {
    report,
    safety: deriveDocumentSafety(report.pages.length, pages, diagnosticPageNumbers)
  }
}
