import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  OCR_CHECK_TUNING,
  aggregatePages,
  buildInkGrid,
  buildRegionMask,
  buildTextGrid,
  classifyImageQuality,
  classifyPage,
  crossCorrelate1D,
  dilate1,
  estimateSkew,
  fitScaleY,
  deriveDocumentSafety,
  gridCoverage,
  laplacianVariance,
  liftBaseline,
  lineAgreement,
  otsuSeparability,
  otsuThreshold,
  paperModeThreshold,
  samplePageIndices,
  type PixelBox,
  type PixelRect
} from '../src/main/services/ocrLayerCheck'
import type { ImageQualityMetrics, OcrPageMetrics } from '../src/shared/types'

// ============================================================================
// Utility per costruire pagine sintetiche in memoria (nessun PDF necessario).
// ============================================================================

const W = 400
const H = 320
const CELL = OCR_CHECK_TUNING.CELL_PX
const INTERLINEA = 24
const ALTEZZA_RIGA = 16
const PRIMA_RIGA_Y = 18

interface RigaSintetica {
  y0: number
  y1: number
  parole: Array<{ x: number; w: number }>
}

/**
 * Prosa giustificata come in un atto: righe di larghezza quasi uguale, numero di
 * parole variabile, e una riga corta di fine paragrafo ogni sette. È la geometria
 * che rende diagnostico lineAgreement — con righe tutte uguali nessuna metrica
 * potrebbe distinguere una riga dalla successiva.
 */
function creaRighe(quante: number): RigaSintetica[] {
  const righe: RigaSintetica[] = []
  let seme = 7
  const rnd = (): number => {
    seme = (seme * 1103515245 + 12345) & 0x7fffffff
    return seme / 0x7fffffff
  }
  for (let i = 0; i < quante; i++) {
    const y0 = PRIMA_RIGA_Y + i * INTERLINEA
    const nParole = 5 + Math.floor(rnd() * 9)
    const fineParagrafo = i % 7 === 6
    const fine = fineParagrafo ? 150 + rnd() * 80 : 350 + rnd() * 25
    const spazi = (nParole - 1) * 5
    const inchiostro = Math.max(nParole * 8, fine - 20 - spazi)
    const pesi: number[] = []
    let totale = 0
    for (let p = 0; p < nParole; p++) {
      const w = 1 + rnd()
      pesi.push(w)
      totale += w
    }
    const parole: Array<{ x: number; w: number }> = []
    let x = 20
    for (let p = 0; p < nParole; p++) {
      const w = Math.max(8, Math.round((pesi[p] / totale) * inchiostro))
      parole.push({ x, w })
      x += w + 5
    }
    righe.push({ y0, y1: y0 + ALTEZZA_RIGA, parole })
  }
  return righe
}

/**
 * Pixmap in scala di grigi: 255 = carta, 0 = inchiostro.
 * Le parole sono tratti verticali sottili su una banda di x-height, non barre piene:
 * con le barre piene la frazione di inchiostro sarebbe il doppio del reale e le
 * metriche di densità non direbbero nulla di utile.
 */
function renderizza(righe: readonly RigaSintetica[], width = W, height = H): Uint8Array {
  const px = new Uint8Array(width * height).fill(255)
  for (const riga of righe) {
    for (const parola of riga.parole) {
      for (let x = parola.x; x < parola.x + parola.w && x < width; x++) {
        if ((x - parola.x) % 3 === 2) continue // spazio fra lettere
        for (let y = riga.y0 + 4; y < riga.y1 - 3 && y < height; y++) px[y * width + x] = 0
      }
    }
  }
  return px
}

/** Bbox di riga dichiarati dal layer di testo, eventualmente traslati. */
function bboxDiRiga(righe: readonly RigaSintetica[], dx = 0, dy = 0): PixelBox[] {
  return righe.map((riga) => {
    const ultima = riga.parole[riga.parole.length - 1]
    return {
      x0: riga.parole[0].x + dx,
      y0: riga.y0 + dy,
      x1: ultima.x + ultima.w + dx,
      y1: riga.y1 + dy,
      words: riga.parole.length
    }
  })
}

const CLIP_INTERO: PixelRect = { x0: 0, y0: 0, x1: W, y1: H }

function grigliaInchiostro(righe: readonly RigaSintetica[]) {
  const px = renderizza(righe)
  const grid = buildInkGrid(px, W, H, W, 128, CELL)
  if (!grid) throw new Error('griglia non costruita')
  return grid
}

/** Istogramma gaussiano, per i test di soglia. */
function aggiungiGaussiana(
  hist: number[],
  media: number,
  sigma: number,
  frazione: number,
  totale: number
): void {
  for (let v = 0; v < 256; v++) {
    hist[v] += Math.round(
      (totale * frazione * Math.exp(-((v - media) ** 2) / (2 * sigma * sigma))) /
        (sigma * Math.sqrt(2 * Math.PI))
    )
  }
}

function frazioneSotto(hist: readonly number[], soglia: number): number {
  const totale = hist.reduce((a, b) => a + b, 0)
  let sotto = 0
  for (let v = 0; v <= soglia; v++) sotto += hist[v]
  return totale > 0 ? sotto / totale : 0
}

// ============================================================================
// Binarizzazione
// ============================================================================

describe('paperModeThreshold', () => {
  it('taglia sotto la moda della carta su un istogramma bimodale', () => {
    const hist = new Array<number>(256).fill(0)
    aggiungiGaussiana(hist, 240, 5, 0.85, 500000)
    aggiungiGaussiana(hist, 40, 10, 0.15, 500000)
    const soglia = paperModeThreshold(hist)
    expect(soglia).toBe(Math.round(240 * 0.75))
    expect(frazioneSotto(hist, soglia)).toBeCloseTo(0.15, 1)
  })

  it('ignora i picchi scuri: la moda si cerca solo nei bin >= 128', () => {
    const hist = new Array<number>(256).fill(0)
    hist[10] = 900000 // pagina quasi tutta nera: non deve diventare "carta"
    hist[250] = 1000
    expect(paperModeThreshold(hist)).toBe(Math.round(250 * 0.75))
  })

  it('resta nei limiti del clamp su istogramma vuoto', () => {
    const soglia = paperModeThreshold(new Array<number>(256).fill(0))
    expect(soglia).toBeGreaterThanOrEqual(OCR_CHECK_TUNING.THRESHOLD_MIN)
    expect(soglia).toBeLessThanOrEqual(OCR_CHECK_TUNING.THRESHOLD_MAX)
  })

  // Questo è IL motivo per cui non usiamo Otsu per binarizzare.
  it('su pagina quasi vuota regge dove Otsu taglia dentro la carta', () => {
    const hist = new Array<number>(256).fill(0)
    // 0,05% di inchiostro, carta rumorosa (sigma 8): scenario tipico di una
    // pagina di sole poche righe uscita da uno scanner.
    aggiungiGaussiana(hist, 248, 8, 0.9995, 500000)
    aggiungiGaussiana(hist, 45, 12, 0.0005, 500000)

    const sogliaOtsu = otsuThreshold(hist)
    const sogliaCarta = paperModeThreshold(hist)

    // Otsu cade DENTRO la distribuzione della carta...
    expect(sogliaOtsu).toBeGreaterThan(230)
    // ...e marcherebbe come inchiostro una frazione enorme della pagina.
    expect(frazioneSotto(hist, sogliaOtsu)).toBeGreaterThan(0.3)

    // La moda della carta resta ben sotto e trova solo il vero inchiostro.
    expect(sogliaCarta).toBeLessThan(200)
    expect(frazioneSotto(hist, sogliaCarta)).toBeLessThan(0.01)
  })
})

describe('otsuSeparability', () => {
  it('vale quasi 1 su due classi nettamente separate', () => {
    const hist = new Array<number>(256).fill(0)
    hist[20] = 30000
    hist[250] = 70000
    expect(otsuSeparability(hist)).toBeGreaterThan(0.95)
  })

  it('crolla su una distribuzione uniforme (inchiostro e carta indistinguibili)', () => {
    const hist = new Array<number>(256).fill(1000)
    expect(otsuSeparability(hist)).toBeLessThan(0.8)
  })

  it('vale 0 su istogramma vuoto o a un solo livello', () => {
    expect(otsuSeparability(new Array<number>(256).fill(0))).toBe(0)
    const unico = new Array<number>(256).fill(0)
    unico[200] = 5000
    expect(otsuSeparability(unico)).toBe(0)
  })
})

// ============================================================================
// Griglie
// ============================================================================

describe('buildInkGrid', () => {
  it('conta i pixel scuri e costruisce i profili di proiezione', () => {
    const righe = creaRighe(10)
    const grid = grigliaInchiostro(righe)
    expect(grid.cols).toBe(Math.ceil(W / CELL))
    expect(grid.rows).toBe(Math.ceil(H / CELL))
    expect(grid.inkPixels).toBeGreaterThan(0)
    expect(grid.inkFraction).toBeGreaterThan(OCR_CHECK_TUNING.INK_FRACTION_MIN)
    expect(grid.rowProfile.length).toBe(H)
    expect(grid.colProfile.length).toBe(W)
    // Il profilo riga ha inchiostro nelle bande delle righe e zero fra una e l'altra.
    expect(grid.rowProfile[PRIMA_RIGA_Y + 5]).toBeGreaterThan(0)
    expect(grid.rowProfile[PRIMA_RIGA_Y + ALTEZZA_RIGA + 5]).toBe(0)
  })

  it('restituisce null se la vista sui pixel si è staccata dalla heap WASM', () => {
    // getPixels() è una vista viva: se la heap cresce, length diventa 0 in silenzio.
    const troncata = new Uint8Array(10)
    expect(buildInkGrid(troncata, W, H, W, 128, CELL)).toBeNull()
    expect(buildInkGrid(new Uint8Array(0), W, H, W, 128, CELL)).toBeNull()
  })

  it('una cella conta come inchiostro solo da CELL_MIN_INK_PX pixel in su', () => {
    const px = new Uint8Array(16 * 16).fill(255)
    px[0] = 0 // un solo pixel scuro nella cella (0,0)
    const grid = buildInkGrid(px, 16, 16, 16, 128, 4)
    expect(grid).not.toBeNull()
    expect(grid?.cells[0]).toBe(0)
    px[1] = 0 // due pixel: ora la cella conta
    const grid2 = buildInkGrid(px, 16, 16, 16, 128, 4)
    expect(grid2?.cells[0]).toBe(1)
  })
})

describe('dilate1', () => {
  it('accende i 4 vicini di ogni cella piena', () => {
    const cells = new Uint8Array(25)
    cells[12] = 1 // centro di una griglia 5x5
    const out = dilate1(cells, 5, 5)
    expect(out[12]).toBe(1)
    expect(out[11]).toBe(1)
    expect(out[13]).toBe(1)
    expect(out[7]).toBe(1)
    expect(out[17]).toBe(1)
    expect(out[6]).toBe(0) // la diagonale no: dilatazione a 4 vicini
    expect(out.reduce((a, b) => a + b, 0)).toBe(5)
  })

  it('non modifica l array di partenza', () => {
    const cells = new Uint8Array(25)
    cells[12] = 1
    dilate1(cells, 5, 5)
    expect(cells.reduce((a, b) => a + b, 0)).toBe(1)
  })
})

describe('buildTextGrid', () => {
  it('clippa i bbox all area immagine e scarta i degeneri', () => {
    const boxes: PixelBox[] = [
      { x0: 10, y0: 10, x1: 100, y1: 22, words: 4 },
      { x0: 10, y0: 500, x1: 100, y1: 512, words: 4 } // fuori dalla pagina
    ]
    const tg = buildTextGrid(boxes, CLIP_INTERO, W, H, CELL)
    expect(tg.boxes).toHaveLength(1)
    expect(tg.cellCount).toBeGreaterThan(0)
  })

  /**
   * Il bbox di riga va dall'ascender al descender, ma l'inchiostro sta fra l'altezza
   * delle maiuscole e la linea di base: profili e celle usano solo quella banda.
   */
  it('profili e celle coprono la banda dei glifi, non il bbox intero', () => {
    const boxes: PixelBox[] = [{ x0: 40, y0: 100, x1: 200, y1: 132, words: 5 }]
    const tg = buildTextGrid(boxes, CLIP_INTERO, W, H, CELL)
    const altezza = 32
    const attesoInizio = 100 + altezza * OCR_CHECK_TUNING.GLYPH_BAND_TOP
    const attesoFine = 100 + altezza * OCR_CHECK_TUNING.GLYPH_BAND_BOTTOM
    expect(tg.rowProfile[101]).toBe(0) // dentro il bbox ma sopra i glifi
    expect(tg.rowProfile[131]).toBe(0) // dentro il bbox ma sotto la linea di base
    expect(tg.rowProfile[Math.round((attesoInizio + attesoFine) / 2)]).toBeGreaterThan(0)
    // Il bbox restituito resta invece a piena altezza: serve a lineAgreement.
    expect(tg.boxes[0].y0).toBe(100)
    expect(tg.boxes[0].y1).toBe(132)
  })

  it('una pagina con una sola riga corta non raggiunge MIN_TEXT_CELLS', () => {
    const boxes: PixelBox[] = [{ x0: 10, y0: 10, x1: 22, y1: 18, words: 1 }]
    const tg = buildTextGrid(boxes, CLIP_INTERO, W, H, CELL)
    expect(tg.cellCount).toBeLessThan(OCR_CHECK_TUNING.MIN_TEXT_CELLS)
  })
})

// ============================================================================
// Coverage, lift, lineAgreement — i casi che contano
// ============================================================================

describe('allineamento su griglie sintetiche', () => {
  const righe = creaRighe(12)
  const grid = grigliaInchiostro(righe)
  const dilatata = dilate1(grid.cells, grid.cols, grid.rows)
  const maschera = buildRegionMask(CLIP_INTERO, W, H, CELL)

  function misura(dx: number, dy: number) {
    const tg = buildTextGrid(bboxDiRiga(righe, dx, dy), CLIP_INTERO, W, H, CELL)
    const coverage = gridCoverage(tg.cells, dilatata)
    const { baseline, lift } = liftBaseline(dilatata, maschera, coverage)
    const accordo = lineAgreement(tg.boxes, grid.inkMask, W, H)
    const dyLag = crossCorrelate1D(grid.rowProfile, tg.rowProfile, 60).lag
    const dxLag = crossCorrelate1D(grid.colProfile, tg.colProfile, 60).lag
    return { coverage, baseline, lift, accordo, dyLag, dxLag }
  }

  it('layer allineato: coverage alta, lift alto, accordo pieno, nessuno scostamento', () => {
    const m = misura(0, 0)
    expect(m.coverage).toBeGreaterThanOrEqual(OCR_CHECK_TUNING.COVERAGE_MIN)
    expect(m.lift).toBeGreaterThanOrEqual(OCR_CHECK_TUNING.LIFT_MIN)
    expect(m.accordo).not.toBeNull()
    expect(m.accordo ?? 0).toBeGreaterThanOrEqual(OCR_CHECK_TUNING.LINE_AGREEMENT_MIN)
    expect(m.dxLag).toBe(0)
    expect(m.dyLag).toBe(0)
    expect(
      classifyPage({
        coverage: m.coverage,
        lift: m.lift,
        lineAgreement: m.accordo,
        scaleY: 1,
        offsetXPt: m.dxLag,
        offsetYPt: m.dyLag
      })
    ).toEqual({ verdict: 'aligned', reason: 'ok' })
  })

  it('traslazione verticale di 3 celle: la coverage crolla', () => {
    const m = misura(0, 3 * CELL)
    expect(m.coverage).toBeLessThan(OCR_CHECK_TUNING.COVERAGE_MIN)
    expect(Math.abs(m.dyLag)).toBeGreaterThan(OCR_CHECK_TUNING.OFFSET_MAX_PT)
  })

  /**
   * La coverage è quasi cieca alle traslazioni orizzontali: una riga di testo è
   * continua in orizzontale, quindi scorrerla di 12px la lascia quasi tutta
   * sull'inchiostro. A prenderla è la cross-correlazione del profilo colonna.
   */
  it('traslazione orizzontale di 3 celle: coverage ancora alta, ma dx la rivela', () => {
    const m = misura(3 * CELL, 0)
    expect(m.coverage).toBeGreaterThan(0.9)
    expect(m.dxLag).toBe(-3 * CELL)
    expect(
      classifyPage({
        coverage: m.coverage,
        lift: m.lift,
        lineAgreement: m.accordo,
        scaleY: 1,
        offsetXPt: m.dxLag,
        offsetYPt: 0
      })
    ).toEqual({ verdict: 'misaligned', reason: 'offset-too-large' })
  })

  // IL caso pericoloso: si redige la riga sbagliata.
  it('sfasamento di esattamente un interlinea: coverage ALTA ma accordo di riga BASSO', () => {
    const m = misura(0, INTERLINEA)
    // Il testo cade sull'inchiostro della riga adiacente, che inchiostro ce l'ha:
    // la coverage da sola darebbe il layer per buono.
    expect(m.coverage).toBeGreaterThanOrEqual(OCR_CHECK_TUNING.COVERAGE_MIN)
    // Righe diverse hanno lunghezze e numero di parole diversi: l'accordo crolla.
    expect(m.accordo).not.toBeNull()
    expect(m.accordo ?? 1).toBeLessThan(OCR_CHECK_TUNING.LINE_AGREEMENT_MIN)
  })

  it('senza lineAgreement lo sfasamento di un interlinea passerebbe inosservato', () => {
    const m = misura(0, INTERLINEA)
    // Con le sole coverage e lift il verdetto sarebbe "aligned": è esattamente
    // questo il buco che lineAgreement chiude.
    expect(
      classifyPage({
        coverage: m.coverage,
        lift: m.lift,
        lineAgreement: null,
        scaleY: 1,
        offsetXPt: 0,
        offsetYPt: 0
      })
    ).toEqual({ verdict: 'aligned', reason: 'ok' })
    expect(
      classifyPage({
        coverage: m.coverage,
        lift: m.lift,
        lineAgreement: m.accordo,
        scaleY: 1,
        offsetXPt: 0,
        offsetYPt: 0
      })
    ).toEqual({ verdict: 'misaligned', reason: 'low-line-agreement' })
  })

  it('layer del tutto scorrelato: coverage bassa e accordo sotto soglia', () => {
    const m = misura(37, INTERLINEA + 8)
    expect(m.coverage).toBeLessThan(OCR_CHECK_TUNING.COVERAGE_MIN)
    expect(m.lift).toBeLessThan(OCR_CHECK_TUNING.LIFT_MIN)
    // Non esattamente 0: lineAgreement confronta ogni riga con l'inchiostro
    // nella SUA finestra x, non sull'intera larghezza di pagina (che in un
    // layout a due colonne o con filetti di tabella darebbe falsi disaccordi).
    // Un layer traslato di 37px trova quindi ancora inchiostro sotto qualche
    // riga. Quello che conta è che l'accordo resti sotto la soglia di giudizio.
    expect(m.accordo).toBeLessThan(OCR_CHECK_TUNING.LINE_AGREEMENT_MIN)
    expect(
      classifyPage({
        coverage: m.coverage,
        lift: m.lift,
        lineAgreement: m.accordo,
        scaleY: 1,
        offsetXPt: 0,
        offsetYPt: 0
      }).verdict
    ).toBe('misaligned')
  })
})

describe('liftBaseline', () => {
  it('su pagina molto inchiostrata il lift resta vicino a 1 anche con coverage 1', () => {
    // Tabelle a griglia piena, timbri, scansioni scure: coverage ≈ 1 per qualunque shift.
    const n = 1000
    const ink = new Uint8Array(n)
    const maschera = new Uint8Array(n).fill(1)
    for (let i = 0; i < 900; i++) ink[i] = 1 // baseline 0,90
    const { baseline, lift } = liftBaseline(ink, maschera, 1)
    expect(baseline).toBeCloseTo(0.9, 5)
    expect(lift).toBeLessThan(OCR_CHECK_TUNING.LIFT_MIN)
  })

  it('su pagina rada il lift è alto', () => {
    const n = 1000
    const ink = new Uint8Array(n)
    const maschera = new Uint8Array(n).fill(1)
    for (let i = 0; i < 150; i++) ink[i] = 1 // baseline 0,15
    const { baseline, lift } = liftBaseline(ink, maschera, 0.95)
    expect(baseline).toBeCloseTo(0.15, 5)
    expect(lift).toBeGreaterThan(OCR_CHECK_TUNING.LIFT_MIN)
  })

  it('baseline 0 non produce divisioni per zero', () => {
    const { baseline, lift } = liftBaseline(new Uint8Array(100), new Uint8Array(100).fill(1), 0.9)
    expect(baseline).toBe(0)
    expect(lift).toBe(0)
  })
})

describe('lineAgreement', () => {
  it('restituisce null sotto le 8 righe utili: meglio astenersi che inventare', () => {
    const righe = creaRighe(7)
    const grid = grigliaInchiostro(righe)
    expect(lineAgreement(bboxDiRiga(righe), grid.inkMask, W, H)).toBeNull()
  })

  it('restituisce un numero da 8 righe utili in su', () => {
    const righe = creaRighe(8)
    const grid = grigliaInchiostro(righe)
    const accordo = lineAgreement(bboxDiRiga(righe), grid.inkMask, W, H)
    expect(accordo).not.toBeNull()
    expect(accordo ?? -1).toBeGreaterThanOrEqual(0)
  })

  it('le righe senza parole o troppo strette non contano come utili', () => {
    const righe = creaRighe(12)
    const grid = grigliaInchiostro(righe)
    const degeneri: PixelBox[] = righe.map((r) => ({
      x0: r.parole[0].x,
      y0: r.y0,
      x1: r.parole[0].x + 2,
      y1: r.y1,
      words: 0
    }))
    expect(lineAgreement(degeneri, grid.inkMask, W, H)).toBeNull()
  })

  it('una riga che cade nel bianco non accorda', () => {
    const righe = creaRighe(12)
    const grid = grigliaInchiostro(righe)
    // Tutte le righe spostate nel margine inferiore, dove non c'è inchiostro.
    const fuori = bboxDiRiga(righe).map((b) => ({ ...b, y0: H - 4, y1: H - 1 }))
    expect(lineAgreement(fuori, grid.inkMask, W, H)).toBe(0)
  })

  it('restituisce null se la maschera dei pixel è più corta della pagina', () => {
    const righe = creaRighe(12)
    expect(lineAgreement(bboxDiRiga(righe), new Uint8Array(10), W, H)).toBeNull()
  })
})

// ============================================================================
// Correlazione, scala, skew, sfocatura
// ============================================================================

describe('crossCorrelate1D', () => {
  function picchi(lunghezza: number, posizioni: readonly number[]): Float64Array {
    const p = new Float64Array(lunghezza)
    for (const pos of posizioni) {
      for (let d = -3; d <= 3; d++) {
        const i = Math.round(pos) + d
        if (i >= 0 && i < lunghezza) p[i] += Math.exp(-(d * d) / 4)
      }
    }
    return p
  }

  it('trova un lag positivo noto', () => {
    const posizioni = [30, 95, 180, 260, 340]
    const riferimento = picchi(400, posizioni)
    const segnale = picchi(400, posizioni.map((p) => p - 7))
    const { lag } = crossCorrelate1D(riferimento, segnale, 60)
    expect(lag).toBe(7)
  })

  it('trova un lag negativo noto', () => {
    const posizioni = [40, 110, 200, 290]
    const riferimento = picchi(400, posizioni)
    const segnale = picchi(400, posizioni.map((p) => p + 11))
    const { lag } = crossCorrelate1D(riferimento, segnale, 60)
    expect(lag).toBe(-11)
  })

  it('lag 0 su segnali identici, con punteggio massimo', () => {
    const riferimento = picchi(400, [50, 120, 220])
    const { lag, score } = crossCorrelate1D(riferimento, riferimento, 60)
    expect(lag).toBe(0)
    expect(score).toBeCloseTo(1, 5)
  })

  it('non esplode su segnali vuoti o costanti', () => {
    expect(crossCorrelate1D(new Float64Array(0), new Float64Array(0), 10).lag).toBe(0)
    const costante = new Float64Array(100).fill(3)
    const r = crossCorrelate1D(costante, costante, 10)
    expect(Number.isFinite(r.score)).toBe(true)
  })
})

describe('fitScaleY', () => {
  function profiloRighe(lunghezza: number, scala: number): Float64Array {
    const p = new Float64Array(lunghezza)
    for (let k = 0; k < 22; k++) {
      const centro = (50 + k * 40) / scala
      for (let d = -4; d <= 4; d++) {
        const i = Math.round(centro) + d
        if (i >= 0 && i < lunghezza) p[i] += Math.exp(-(d * d) / 6)
      }
    }
    return p
  }

  it('riconosce una deriva di scala dell 1 percento', () => {
    // Layer costruito a una risoluzione e applicato a una pagina dimensionata
    // per un altra: dy cresce con y, perfetto in cima e fuori in fondo.
    const inchiostro = profiloRighe(900, 1)
    const testo = profiloRighe(900, 1.01)
    const { scaleY } = fitScaleY(inchiostro, testo, 60)
    expect(scaleY).toBeGreaterThan(1.005)
    expect(scaleY).toBeCloseTo(1.01, 2)
    expect(Math.abs(scaleY - 1)).toBeGreaterThan(OCR_CHECK_TUNING.SCALE_TOLERANCE)
  })

  it('scala 1 quando i profili coincidono', () => {
    const p = profiloRighe(900, 1)
    const { scaleY } = fitScaleY(p, p, 60)
    expect(Math.abs(scaleY - 1)).toBeLessThanOrEqual(OCR_CHECK_TUNING.SCALE_TOLERANCE)
  })

  it('una traslazione pura non viene scambiata per un errore di scala', () => {
    const inchiostro = profiloRighe(900, 1)
    const testo = new Float64Array(900)
    for (let i = 0; i < 900; i++) testo[i] = i >= 5 ? inchiostro[i - 5] : 0
    const { scaleY } = fitScaleY(inchiostro, testo, 60)
    expect(Math.abs(scaleY - 1)).toBeLessThanOrEqual(OCR_CHECK_TUNING.SCALE_TOLERANCE)
  })

  it('si astiene se una delle due bande ha troppo poco testo', () => {
    // Il terzo inferiore di una pagina è spesso margine bianco: meglio non misurare
    // affatto che riportare un errore di scala ricavato dal rumore.
    const inchiostro = profiloRighe(900, 1)
    const testo = new Float64Array(900)
    for (let i = 0; i < 200; i++) testo[i] = inchiostro[i] // testo solo in cima
    testo[880] = 0.01 // una traccia isolata in fondo, sotto la massa minima
    expect(fitScaleY(inchiostro, testo, 60).scaleY).toBe(1)
  })

  it('profili troppo corti: scala neutra, nessun errore', () => {
    expect(fitScaleY(new Float64Array(9), new Float64Array(9), 60).scaleY).toBe(1)
  })
})

describe('estimateSkew', () => {
  /** Celle inchiostrate lungo righe inclinate di `gradi`. */
  function grigliaInclinata(cols: number, rows: number, gradi: number): Uint16Array {
    const g = new Uint16Array(cols * rows)
    const t = Math.tan((gradi * Math.PI) / 180)
    for (let k = 0; k < 10; k++) {
      const y0 = 5 + k * 9
      for (let c = 0; c < cols; c++) {
        const r = Math.round(y0 + c * t)
        if (r >= 0 && r < rows) g[r * cols + c] = 16
      }
    }
    return g
  }

  it('ritrova un angolo noto positivo', () => {
    const g = grigliaInclinata(200, 100, 2)
    expect(estimateSkew(g, 200, 100)).toBeCloseTo(2, 0)
  })

  it('ritrova un angolo noto negativo', () => {
    const g = grigliaInclinata(200, 100, -1.5)
    expect(estimateSkew(g, 200, 100)).toBeCloseTo(-1.5, 0)
  })

  it('vale circa 0 su righe orizzontali', () => {
    const g = grigliaInclinata(200, 100, 0)
    expect(Math.abs(estimateSkew(g, 200, 100))).toBeLessThanOrEqual(0.5)
  })

  it('vale 0 quando non c è abbastanza inchiostro', () => {
    expect(estimateSkew(new Uint16Array(200 * 100), 200, 100)).toBe(0)
  })
})

describe('laplacianVariance', () => {
  it('è più alto su bordi netti che su bordi sfumati', () => {
    const w = 64
    const h = 64
    const netto = new Uint8Array(w * h).fill(255)
    const sfumato = new Uint8Array(w * h).fill(255)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= 30 && x < 34) netto[y * w + x] = 0
        const d = Math.abs(x - 32)
        sfumato[y * w + x] = d < 8 ? Math.round((255 * d) / 8) : 255
      }
    }
    expect(laplacianVariance(netto, w, h, w)).toBeGreaterThan(
      laplacianVariance(sfumato, w, h, w)
    )
  })

  it('vale 0 su immagine piatta o troppo piccola', () => {
    expect(laplacianVariance(new Uint8Array(64 * 64).fill(200), 64, 64, 64)).toBe(0)
    expect(laplacianVariance(new Uint8Array(4), 2, 2, 2)).toBe(0)
  })
})

// ============================================================================
// Verdetti
// ============================================================================

describe('classifyPage', () => {
  const buono = {
    coverage: 0.95,
    lift: 3,
    lineAgreement: 0.9,
    scaleY: 1,
    offsetXPt: 0,
    offsetYPt: 0
  }

  it('aligned quando tutte le condizioni reggono', () => {
    expect(classifyPage(buono)).toEqual({ verdict: 'aligned', reason: 'ok' })
  })

  it('aligned anche con lineAgreement null (troppe poche righe)', () => {
    expect(classifyPage({ ...buono, lineAgreement: null })).toEqual({
      verdict: 'aligned',
      reason: 'ok'
    })
  })

  it('errore di scala: ha la precedenza su tutto', () => {
    expect(classifyPage({ ...buono, scaleY: 1.02 }).reason).toBe('scale-mismatch')
  })

  it('offset oltre 4pt', () => {
    expect(classifyPage({ ...buono, offsetYPt: 9 }).reason).toBe('offset-too-large')
    expect(classifyPage({ ...buono, offsetXPt: -9 }).reason).toBe('offset-too-large')
  })

  it('accordo di riga insufficiente', () => {
    expect(classifyPage({ ...buono, lineAgreement: 0.3 }).reason).toBe('low-line-agreement')
  })

  it('coverage e lift insufficienti', () => {
    expect(classifyPage({ ...buono, coverage: 0.4 }).reason).toBe('low-coverage')
    expect(classifyPage({ ...buono, lift: 1.1 }).reason).toBe('low-lift')
  })
})

describe('classifyImageQuality', () => {
  const base: ImageQualityMetrics = {
    nativeDpi: 300,
    xHeightPx: 20,
    separability: 0.9,
    skewDeg: 0,
    blurScore: 1
  }

  it('good su una scansione sana', () => {
    expect(classifyImageQuality(base)).toEqual({ verdict: 'good', reasons: [] })
  })

  it('soglia 200 DPI: sotto è marginal, a 200 è good', () => {
    expect(classifyImageQuality({ ...base, nativeDpi: 200 }).verdict).toBe('good')
    const r = classifyImageQuality({ ...base, nativeDpi: 199 })
    expect(r.verdict).toBe('marginal')
    expect(r.reasons).toContain('low-native-dpi')
  })

  it('soglia 150 DPI: sotto è poor', () => {
    expect(classifyImageQuality({ ...base, nativeDpi: 150 }).verdict).toBe('marginal')
    const r = classifyImageQuality({ ...base, nativeDpi: 149 })
    expect(r.verdict).toBe('poor')
    expect(r.reasons).toContain('very-low-native-dpi')
  })

  it('soglia 10px di x-height: sotto è marginal, a 10 è good', () => {
    expect(classifyImageQuality({ ...base, xHeightPx: 10 }).verdict).toBe('good')
    const r = classifyImageQuality({ ...base, xHeightPx: 9.5 })
    expect(r.verdict).toBe('marginal')
    expect(r.reasons).toContain('small-x-height')
  })

  it('soglia 8px di x-height: sotto Tesseract rimuove il testo come rumore', () => {
    expect(classifyImageQuality({ ...base, xHeightPx: 8 }).verdict).toBe('marginal')
    const r = classifyImageQuality({ ...base, xHeightPx: 7.9 })
    expect(r.verdict).toBe('poor')
    expect(r.reasons).toContain('very-small-x-height')
  })

  it('metriche non ricavabili: nessun motivo, nessun peggioramento', () => {
    expect(classifyImageQuality({ ...base, nativeDpi: null, xHeightPx: null })).toEqual({
      verdict: 'good',
      reasons: []
    })
  })

  it('separabilità bassa e inclinazione', () => {
    expect(classifyImageQuality({ ...base, separability: 0.3 }).reasons).toContain(
      'low-separability'
    )
    expect(classifyImageQuality({ ...base, skewDeg: 3 }).reasons).toContain('skewed')
    expect(classifyImageQuality({ ...base, skewDeg: -6 }).reasons).toContain('very-skewed')
    expect(classifyImageQuality({ ...base, skewDeg: -6 }).verdict).toBe('poor')
  })

  // SEGNALE DEBOLE: le soglie note vengono da foto naturali, non predicono l'errore OCR.
  it('blurScore da solo non genera mai un avviso', () => {
    const r = classifyImageQuality({ ...base, blurScore: 0 })
    expect(r.verdict).toBe('good')
    expect(r.reasons).not.toContain('possibly-blurred')
  })

  it('blurScore si annota solo se il verdetto è già compromesso', () => {
    const r = classifyImageQuality({ ...base, nativeDpi: 120, blurScore: 0 })
    expect(r.verdict).toBe('poor')
    expect(r.reasons).toContain('possibly-blurred')
  })
})

describe('aggregatePages', () => {
  const pagina = (verdict: OcrPageMetrics['verdict'], page: number): OcrPageMetrics => ({
    page,
    verdict,
    reason: verdict === 'aligned' ? 'ok' : 'low-coverage',
    coverage: 0,
    lift: 0,
    lineAgreement: null,
    scaleY: 1,
    offsetXPt: 0,
    offsetYPt: 0
  })

  it('una sola pagina disallineata rende non affidabile l intero layer', () => {
    expect(
      aggregatePages([pagina('aligned', 1), pagina('aligned', 2), pagina('misaligned', 3)])
    ).toBe('misaligned')
  })

  it('maggioranza disallineata', () => {
    expect(
      aggregatePages([pagina('aligned', 1), pagina('misaligned', 2), pagina('misaligned', 3)])
    ).toBe('misaligned')
  })

  it('parità: prudenza, misaligned', () => {
    expect(aggregatePages([pagina('aligned', 1), pagina('misaligned', 2)])).toBe('misaligned')
  })

  it('tutte inconcludenti', () => {
    expect(aggregatePages([pagina('inconclusive', 1), pagina('inconclusive', 2)])).toBe(
      'inconclusive'
    )
    expect(aggregatePages([])).toBe('inconclusive')
  })

  it('una pagina raster inconcludente impedisce di certificare il layer', () => {
    expect(
      aggregatePages([pagina('inconclusive', 1), pagina('inconclusive', 2), pagina('aligned', 3)])
    ).toBe('inconclusive')
  })
})

describe('deriveDocumentSafety', () => {
  const metrics = {
    coverage: null,
    lift: null,
    lineAgreement: null,
    scaleY: null,
    offsetXPt: null,
    offsetYPt: null
  }

  it('instrada un PDF misto interamente sul percorso raster', () => {
    const safety = deriveDocumentSafety(2, [
      {
        page: 1,
        status: 'digital',
        layerKind: 'digital',
        existingTextLayerUsable: false,
        reason: 'not-raster-page',
        metrics,
        imageMetrics: null
      },
      {
        page: 2,
        status: 'scan-aligned',
        layerKind: 'scan-with-text',
        existingTextLayerUsable: true,
        reason: 'ok',
        metrics: { ...metrics, coverage: 0.95, lift: 2, scaleY: 1, offsetXPt: 0, offsetYPt: 0 },
        imageMetrics: null
      }
    ], [1])
    expect(safety.routing).toBe('flattened-scan')
    expect(safety.allPagesAnalyzed).toBe(true)
    expect(safety.existingTextLayerUsable).toBe(true)
    expect(safety.diagnosticPageNumbers).toEqual([1])
  })

  it('un errore pagina e una scansione non fidata restano espliciti', () => {
    const safety = deriveDocumentSafety(3, [
      {
        page: 1,
        status: 'scan-aligned',
        layerKind: 'scan-with-text',
        existingTextLayerUsable: true,
        reason: 'ok',
        metrics,
        imageMetrics: null
      },
      {
        page: 2,
        status: 'page-error',
        layerKind: null,
        existingTextLayerUsable: false,
        reason: 'page-error',
        metrics,
        imageMetrics: null
      },
      {
        page: 3,
        status: 'scan-untrusted',
        layerKind: 'scan-no-text',
        existingTextLayerUsable: false,
        reason: 'no-text-layer',
        metrics,
        imageMetrics: null
      }
    ])
    expect(safety.routing).toBe('flattened-scan')
    expect(safety.hasPageErrors).toBe(true)
    expect(safety.existingTextLayerUsable).toBe(false)
    expect(safety.pages.map((page) => page.status)).toEqual([
      'scan-aligned',
      'page-error',
      'scan-untrusted'
    ])
  })

  it('non dichiara completa un analisi con una pagina mancante', () => {
    const safety = deriveDocumentSafety(2, [{
      page: 1,
      status: 'digital',
      layerKind: 'digital',
      existingTextLayerUsable: false,
      reason: 'not-raster-page',
      metrics,
      imageMetrics: null
    }])
    expect(safety.allPagesAnalyzed).toBe(false)
  })
})

describe('samplePageIndices', () => {
  it('documento corto: tutte le pagine', () => {
    expect(samplePageIndices(3, 5)).toEqual([0, 1, 2])
  })

  it('documento lungo: prima, ultima e le intermedie distribuite', () => {
    const idx = samplePageIndices(100, 5)
    expect(idx).toHaveLength(5)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(99)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('documento vuoto', () => {
    expect(samplePageIndices(0, 5)).toEqual([])
  })
})

describe('classifyImageQuality — non giudicare ciò che non è stato misurato', () => {
  it('separabilità e sfocatura a zero producono un verdetto, e per questo non vanno passate quando non sono misurate', () => {
    // Questo test documenta il motivo della guardia in analyzeOcrLayer: con
    // metriche a zero — che è il valore di "non misurato", non di "misurato
    // male" — classifyImageQuality accusa la scansione senza averla vista.
    const { verdict, reasons } = classifyImageQuality({
      nativeDpi: null,
      xHeightPx: null,
      separability: 0,
      skewDeg: 0,
      blurScore: 0
    })
    expect(verdict).toBe('marginal')
    expect(reasons).toContain('low-separability')
    expect(reasons).toContain('possibly-blurred')
  })

  it('su misure reali buone non accusa nulla', () => {
    const { verdict, reasons } = classifyImageQuality({
      nativeDpi: 300,
      xHeightPx: 20,
      separability: 0.8,
      skewDeg: 0.2,
      blurScore: 0.9
    })
    expect(verdict).toBe('good')
    expect(reasons).toEqual([])
  })
})
