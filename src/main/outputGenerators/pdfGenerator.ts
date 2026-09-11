import fs from 'fs/promises'
import path from 'path'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { app } from 'electron'
import type { DetectedEntity, PdfLayerKind, SaveResult } from '@shared/types'
import type { PdfPageQualityOutcome } from '../services/ocrLayerCheck'
import { getTessdataPath } from '../services/nerService'
import { dpiToScale } from '../services/ocrRenderConfig'
import log from 'electron-log'
import { generateImagePdfSafe, generatePdfSafe } from './pdfSafeGenerator'

/**
 * pdfGenerator.ts — anonimizzazione dei PDF.
 *
 * PERCHÉ QUESTO FILE È DELICATO
 * Qui avviene l'unica modifica DISTRUTTIVA e IRREVERSIBILE dell'applicazione: con
 * `REDACT_IMAGE_PIXELS` MuPDF decodifica il raster della scansione, azzera in bianco
 * i pixel coperti e lo ri-codifica. Non esiste un "annulla". Ogni scelta qui sotto è
 * pensata per degradare in modo controllato invece che distruggere in silenzio.
 *
 * I tipi e gli helper dei vecchi modi di redazione restano temporaneamente esportati
 * per i test di regressione. Gli entry point pubblici delegano esclusivamente a
 * pdfSafeGenerator: nessun percorso di produzione può usare il fallback overlay.
 *
 * MODI STORICI (vedi selectRedactionMode)
 *  - 'digital'                → PDF nativo: applyRedactions(false, REDACT_IMAGE_NONE).
 *                               INVARIATO rispetto alle versioni precedenti.
 *  - 'pixels-from-text-layer' → scansione con layer OCR certificato allineato: i quad
 *                               vengono dal layer di testo (niente Tesseract, è il
 *                               percorso veloce) e i pixel vengono davvero azzerati.
 *  - 'pixels-from-ocr'        → ogni altra scansione: box parola da Tesseract e pixel
 *                               azzerati.
 *  - 'overlay'                → valore legacy, non raggiungibile dagli entry point.
 *
 * PRIVACY (CLAUDE.md §6): in questo file non viene mai loggato testo del documento.
 * Gli pseudonimi sono ammessi (convenzione già in uso nel progetto), il testo
 * originale e le parole riconosciute dall'OCR no — mai, nemmeno in debug.
 */

// ============================================================================
// Tipi pubblici
// ============================================================================

export type RedactionMode =
  | 'digital'
  | 'pixels-from-text-layer'
  | 'pixels-from-ocr'
  | 'overlay'

/** Modo scelto in partenza. 'overlay' non è mai una scelta: è solo un esito di ripiego. */
export type SelectedRedactionMode = Exclude<RedactionMode, 'overlay'>

export interface PdfGenerateOptions {
  isScanned?: boolean
  layerKind?: PdfLayerKind
  ocrAligned?: boolean
  /**
   * DPI di rendering per il ri-OCR. Il DPI si PASSA, non si ricalcola: se il valore
   * usato per renderizzare e quello usato per riconvertire i box di Tesseract in punti
   * divergono, le redazioni finiscono fuori posto **senza alcun errore**, su un output
   * che l'app dichiara riuscito. Vedi services/ocrRenderConfig.ts.
   */
  ocrDpi?: number
  routing?: SaveResult['redactionMode']
  pageSafety?: PdfPageQualityOutcome[]
  analysisToken?: string
}

/**
 * Risultato esteso. `SaveResult` vive in @shared/types e non è di competenza di questo
 * modulo: i campi diagnostici sono aggiunti qui in modo strutturalmente compatibile,
 * così un consumatore tipizzato su SaveResult continua a funzionare invariato.
 */
export type PdfSaveResult = SaveResult

/** Forma del risultato della pipeline pre-v1.6, mantenuta solo dagli helper non
 * esportati usati dai test di regressione. Il punto di ingresso pubblico non può
 * più restituirla. */
interface LegacyPdfSaveResult {
  outputPath: string
  entitiesReplaced: number
  sizeRatio?: number
  sizeWarning?: boolean
  redactionMode: RedactionMode
  fellBackToOverlay: boolean
}

// ============================================================================
// Costanti di sicurezza
// ============================================================================

/**
 * Un rettangolo di redazione più grande di questa frazione della pagina è quasi
 * sicuramente un errore di coordinate. Con REDACT_IMAGE_PIXELS distruggerebbe la
 * pagina in modo irreversibile: si rifiuta e si logga.
 */
export const MAX_REDACTION_AREA_RATIO = 0.25

/** Soglie di allarme sulla dimensione dell'output. */
export const SIZE_RATIO_WARN = 3
export const SIZE_BYTES_WARN = 20 * 1024 * 1024

/** Soglia di grigio sotto la quale un pixel conta come inchiostro (0-255). */
const INK_THRESHOLD = 160
/** Sotto questa frazione la pagina è considerata vuota. */
const VALIDATION_INK_MIN = 0.002
/** Sopra questa frazione la pagina è annerita: la redazione ha distrutto tutto. */
const VALIDATION_INK_MAX = 0.95

/** Padding attorno al box parola, in punti. */
const BOX_PADDING_PT = 1

/** Solo questi spazi colore sono sicuri per REDACT_IMAGE_PIXELS su MuPDF 1.27.0.
 *  Gli altri (Indexed, Separation, DeviceN, ICCBased, Lab, Cal*) sono colpiti dal
 *  bug 709269, corretto solo in MuPDF 1.28.1. */
const BASIC_COLORSPACES = new Set(['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'G', 'RGB', 'CMYK'])

/** Profondità massima di discesa nei Form XObject annidati. */
const XOBJECT_MAX_DEPTH = 6

// ============================================================================
// Caricamento pigro di MuPDF (modulo pesante — CLAUDE.md, Performance Livello 2)
// ============================================================================

async function loadMupdf() {
  return (await import('mupdf')).default
}

type Mupdf = Awaited<ReturnType<typeof loadMupdf>>
type MupdfPage = import('mupdf').PDFPage
type MupdfObject = import('mupdf').PDFObject

// ============================================================================
// Funzioni pure — testate in tests/pdfGenerator.test.ts
// ============================================================================

/**
 * Sceglie il modo di redazione.
 *
 * REGOLA DI PRUDENZA: in dubbio NON si usa il percorso veloce. Un `verdict` incerto,
 * un `layerKind` assente o un `ocrAligned` non esplicitamente `true` portano ai box di
 * Tesseract, che sono auto-consistenti per costruzione (stessa passata che renderizza
 * e che misura). L'incertezza deve costare tempo, non correttezza.
 */
export function selectRedactionMode(options: PdfGenerateOptions): SelectedRedactionMode {
  const { isScanned, layerKind, ocrAligned } = options

  // `isScanned` è il flag storico: quando è acceso il testo è stato estratto via OCR,
  // quindi il documento non è mai trattabile come nativo.
  if (isScanned === true) {
    if (layerKind === 'scan-with-text' && ocrAligned === true) return 'pixels-from-text-layer'
    return 'pixels-from-ocr'
  }

  if (layerKind === 'scan-with-text') {
    // Il caso che prima finiva erroneamente sul percorso nativo: migliaia di caratteri
    // per pagina, ma i dati personali stanno nei pixel, non nei glifi.
    return ocrAligned === true ? 'pixels-from-text-layer' : 'pixels-from-ocr'
  }
  if (layerKind === 'scan-no-text') return 'pixels-from-ocr'

  // 'digital' oppure layerKind assente con isScanned spento: comportamento storico.
  return 'digital'
}

/** Rettangolo in punti PDF, coordinate MuPDF (y=0 in alto). */
export interface PointRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Converte un box parola espresso in pixel del rendering in punti PDF.
 *
 * `dpi` DEVE essere lo stesso usato per renderizzare la pagina: è per questo che
 * arriva come parametro e non come costante locale (vedi ocrRenderConfig.ts).
 */
export function pixelBoxToPdfPoints(
  box: PointRect,
  dpi: number,
  originX: number,
  originY: number,
  padPt: number = BOX_PADDING_PT
): PointRect {
  const scale = dpiToScale(dpi)
  return {
    x0: box.x0 / scale + originX - padPt,
    y0: box.y0 / scale + originY - padPt,
    x1: box.x1 / scale + originX + padPt,
    y1: box.y1 / scale + originY + padPt
  }
}

/** Guardia del 25%: un rettangolo più grande di così non viene mai redatto. */
export function isRedactionAreaAcceptable(
  rect: PointRect,
  pageWidth: number,
  pageHeight: number
): boolean {
  const w = rect.x1 - rect.x0
  const h = rect.y1 - rect.y0
  if (w <= 0 || h <= 0) return false
  const pageArea = pageWidth * pageHeight
  if (pageArea <= 0) return false
  return (w * h) / pageArea <= MAX_REDACTION_AREA_RATIO
}

/** Calcola se la dimensione dell'output va segnalata all'utente. */
export function computeSizeWarning(inputBytes: number, outputBytes: number): {
  sizeRatio: number
  sizeWarning: boolean
} {
  const sizeRatio = inputBytes > 0 ? outputBytes / inputBytes : 1
  return {
    sizeRatio,
    sizeWarning: sizeRatio > SIZE_RATIO_WARN || outputBytes > SIZE_BYTES_WARN
  }
}

export type ImageSafetyReason =
  | 'ok'
  | 'no-images'
  | 'transparency-mask'
  | 'non-basic-colorspace'
  | 'image-mask'
  | 'inspection-failed'

export interface ImageSafety {
  safe: boolean
  reason: ImageSafetyReason
}

/**
 * Stabilisce se una pagina può essere redatta con REDACT_IMAGE_PIXELS.
 *
 * Due controindicazioni documentate, entrambe non risolte nella versione di MuPDF
 * a cui siamo pinnati (1.27.0):
 *  - immagini con /SMask o /Mask: la documentazione PyMuPDF avverte esplicitamente
 *    che la trasparenza è «incorrectly handled»;
 *  - spazi colore non basici (Indexed, Separation, DeviceN, ICCBased, Lab, Cal*):
 *    bug 709269, corretto solo in 1.28.1.
 *
 * Queste informazioni restano disponibili per il corpus storico. Il generatore D1
 * corrente ricostruisce comunque l'intera pagina; un errore fallisce senza output.
 */
export function evaluatePageImageSafety(page: MupdfPage): ImageSafety {
  try {
    const resources = page.getObject().getInheritable('Resources')
    const found = { images: 0 }
    const reason = scanXObjectsForUnsafeImage(resources, 0, new Set<number>(), found)
    if (reason !== null) return { safe: false, reason }
    return { safe: true, reason: found.images > 0 ? 'ok' : 'no-images' }
  } catch {
    return { safe: false, reason: 'inspection-failed' }
  }
}

/** Restituisce il primo motivo di non sicurezza trovato, o null se tutto è sicuro. */
function scanXObjectsForUnsafeImage(
  resources: MupdfObject,
  depth: number,
  seen: Set<number>,
  found: { images: number }
): ImageSafetyReason | null {
  if (depth > XOBJECT_MAX_DEPTH) return 'inspection-failed'
  if (!resources || resources.isNull() || !resources.isDictionary()) return null

  const xobjects = resources.get('XObject')
  if (xobjects.isNull() || !xobjects.isDictionary()) return null

  let unsafe: ImageSafetyReason | null = null

  xobjects.forEach((value) => {
    if (unsafe !== null) return

    // Un XObject condiviso fra più pagine va ispezionato una volta sola.
    if (value.isIndirect()) {
      const num = value.asIndirect()
      if (seen.has(num)) return
      seen.add(num)
    }

    const obj = value.resolve()
    if (obj.isNull()) return

    const subtype = obj.get('Subtype')
    const subtypeName = subtype.isName() ? subtype.asName() : ''

    if (subtypeName === 'Form') {
      const nested = scanXObjectsForUnsafeImage(obj.get('Resources'), depth + 1, seen, found)
      if (nested !== null) unsafe = nested
      return
    }
    if (subtypeName !== 'Image') return

    found.images += 1

    // Maschera stencil: è essa stessa una maschera, vale la stessa avvertenza.
    const imageMask = obj.get('ImageMask')
    if (imageMask.isBoolean() && imageMask.asBoolean()) {
      unsafe = 'image-mask'
      return
    }

    if (!obj.get('SMask').isNull() || !obj.get('Mask').isNull()) {
      unsafe = 'transparency-mask'
      return
    }

    if (!isBasicColorSpace(obj.get('ColorSpace'))) {
      unsafe = 'non-basic-colorspace'
    }
  })

  return unsafe
}

function isBasicColorSpace(cs: MupdfObject): boolean {
  if (cs.isNull()) return false
  if (cs.isName()) return BASIC_COLORSPACES.has(cs.asName())
  // Un array è sempre uno spazio composto: Indexed, ICCBased, Separation, DeviceN, Lab…
  return false
}

// ============================================================================
// Punto di ingresso
// ============================================================================

/**
 * Anonimizza un PDF. Il modo di redazione dipende da `layerKind`/`ocrAligned`
 * (vedi selectRedactionMode).
 */
export async function generatePdf(
  filePath: string,
  entities: DetectedEntity[],
  options: PdfGenerateOptions = {}
): Promise<PdfSaveResult> {
  const mode = options.routing
    ?? (selectRedactionMode(options) === 'digital' ? 'digital' : 'flattened-scan')
  return generatePdfSafe(filePath, entities, { ...options, routing: mode })
}

/**
 * Anonimizza un'immagine (PNG/JPG) producendo un PDF.
 *
 * Prima questo caso veniva instradato a `generatePdf`, che apriva il PNG come PDF e
 * sollevava eccezione. L'immagine viene incapsulata in un PDF a un pixel per punto,
 * così il rendering a 72 DPI restituisce esattamente il raster nativo e la conversione
 * pixel↔punti è l'identità.
 */
export async function generatePdfFromImage(
  filePath: string,
  entities: DetectedEntity[],
  options: Pick<PdfGenerateOptions, 'analysisToken'> = {},
): Promise<PdfSaveResult> {
  return generateImagePdfSafe(filePath, entities, options.analysisToken)
}

function buildOutputPath(filePath: string): string {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  return path.join(dir, `${base}_anonimizzato.pdf`)
}

// ============================================================================
// Implementazione pre-v1.6 mantenuta soltanto come fixture di regressione interna.
// Non è chiamata dagli entry point pubblici e deve fallire chiuso se riattivata.
// ============================================================================

interface RedactionBox {
  page: number      // 0-based
  x0: number        // coordinate MuPDF (y=0 in alto)
  y0: number
  x1: number
  y1: number
  pageHeight: number  // altezza pagina MuPDF — serve per convertire a pdf-lib (y=0 in basso)
  pseudo: string
}

/**
 * Anonimizza un PDF nativo in due fasi:
 * 1. MuPDF: rimuove fisicamente il testo originale dai layer PDF (non recuperabile)
 * 2. pdf-lib: scrive il testo sostitutivo nelle stesse posizioni su sfondo grigio chiaro
 *
 * Su un PDF digitale funziona: i glifi vengono davvero rimossi. È una scelta esplicita
 * dell'utente e non c'è ragione di rischiare — il comportamento resta quello storico,
 * incluso `applyRedactions(false, 0)`.
 */
async function generatePdfDigital(
  filePath: string,
  entities: DetectedEntity[]
): Promise<LegacyPdfSaveResult> {
  const mupdf = await loadMupdf()

  const fileBuffer = await fs.readFile(filePath)
  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  // ── Fase 1: MuPDF — rimuove il testo e raccoglie le coordinate ──────────────
  const doc = new mupdf.PDFDocument(new Uint8Array(fileBuffer))
  const redactionBoxes: RedactionBox[] = []

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i)
    let hasRedact = false

    // Altezza pagina in coordinate MuPDF (punti, y=0 in alto)
    const bounds = page.getBounds()
    const pageHeight = bounds[3] - bounds[1]

    for (const entity of confirmed) {
      const hits = page.search(entity.originalText)
      if (hits.length === 0) continue
      hasRedact = true

      for (const quads of hits) {
        const [x0, y0, x1, y1] = quadsToBbox(quads)
        const annot = page.createAnnotation('Redact')
        annot.setRect([x0, y0, x1, y1])
        annot.setContents(entity.pseudonym)
        annot.update()
        redactionBoxes.push({ page: i, x0, y0, x1, y1, pageHeight, pseudo: entity.pseudonym })
      }
    }

    if (hasRedact) {
      // false = nessun riempimento nero — solo rimozione del testo.
      // 0 = REDACT_IMAGE_NONE: su un PDF nativo non c'è nulla da azzerare nei raster.
      page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE)
      page.update()
    }
  }

  const mupdfBytes = copyOut(doc.saveToBuffer('garbage=compact,incremental=no').asUint8Array())

  // ── Fase 2: pdf-lib — disegna testo sostitutivo nelle stesse posizioni ──────
  const finalBytes = await drawPseudonyms(mupdfBytes, redactionBoxes, 'light')

  const outputPath = buildOutputPath(filePath)
  await fs.writeFile(outputPath, finalBytes)

  const { sizeRatio, sizeWarning } = computeSizeWarning(fileBuffer.length, finalBytes.length)
  return {
    outputPath,
    entitiesReplaced: new Set(redactionBoxes.map((b) => b.pseudo)).size,
    redactionMode: 'digital',
    sizeRatio,
    sizeWarning,
    fellBackToOverlay: false
  }
}

// ============================================================================
// Percorsi 'scan' — redazione dei pixel con rete di sicurezza
// ============================================================================

/**
 * Anonimizza una scansione.
 *
 * Flusso:
 *  1. raccoglie i box (dal layer di testo se certificato allineato, altrimenti da Tesseract)
 *  2. decide pagina per pagina se REDACT_IMAGE_PIXELS è applicabile
 *  3. produce i byte redatti e li VALIDA prima di scriverli su disco
 *  4. se la validazione fallisce scarta tutto e ricade sull'overlay
 */
async function generateScannedPdf(
  sourceBytes: Uint8Array,
  outputPath: string,
  entities: DetectedEntity[],
  mode: Exclude<SelectedRedactionMode, 'digital'>,
  ocrDpi: number,
  inputSizeBytes: number
): Promise<LegacyPdfSaveResult> {
  const mupdf = await loadMupdf()

  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  if (confirmed.length === 0) {
    // Nessuna entità da oscurare: l'output è il documento di partenza.
    await fs.writeFile(outputPath, sourceBytes)
    const { sizeRatio, sizeWarning } = computeSizeWarning(inputSizeBytes, sourceBytes.length)
    return {
      outputPath,
      entitiesReplaced: 0,
      redactionMode: mode,
      sizeRatio,
      sizeWarning,
      fellBackToOverlay: false
    }
  }

  // ── 1. Box di redazione ────────────────────────────────────────────────────
  const boxes =
    mode === 'pixels-from-text-layer'
      ? collectBoxesFromTextLayer(mupdf, sourceBytes, confirmed)
      : await collectBoxesFromOcr(mupdf, sourceBytes, confirmed, ocrDpi)

  if (boxes.length === 0) {
    // Nessuna corrispondenza: non c'è nulla da redigere e non ha senso ri-scrivere il
    // documento con MuPDF, che su una scansione ne cambierebbe la dimensione a vuoto.
    log.warn('pdfGenerator: nessuna corrispondenza da redigere', { redactionMode: mode })
    await fs.writeFile(outputPath, sourceBytes)
    const { sizeRatio, sizeWarning } = computeSizeWarning(inputSizeBytes, sourceBytes.length)
    return {
      outputPath,
      entitiesReplaced: 0,
      redactionMode: mode,
      sizeRatio,
      sizeWarning,
      fellBackToOverlay: false
    }
  }

  // entitiesReplaced si calcola UNA VOLTA su tutte le pagine. Prima era assegnato
  // dentro il ciclo pagine, quindi l'ultima pagina sovrascriveva il conteggio delle
  // precedenti e un documento di 10 pagine ne dichiarava una sola.
  const entitiesReplaced = new Set(boxes.map((b) => b.pseudo)).size

  // ── 2. Sicurezza per pagina + riferimento per la validazione ───────────────
  const probe = new mupdf.PDFDocument(sourceBytes)
  const pageCount = probe.countPages()
  const pixelSafePages = new Set<number>()
  let anyUnsafe = false
  const touchedPages = new Set(boxes.map((b) => b.page))

  for (const pageIndex of touchedPages) {
    const safety = evaluatePageImageSafety(probe.loadPage(pageIndex))
    if (safety.safe) {
      pixelSafePages.add(pageIndex)
    } else {
      anyUnsafe = true
      log.warn('pdfGenerator: pagina non idonea a REDACT_IMAGE_PIXELS, ripiego su overlay', {
        page: pageIndex + 1,
        reason: safety.reason
      })
    }
  }
  const referenceInk = firstPageInkFraction(mupdf, probe)

  // ── 3. Tentativo con azzeramento dei pixel ─────────────────────────────────
  let fellBackToOverlay = anyUnsafe
  let effectiveMode: RedactionMode = anyUnsafe && pixelSafePages.size === 0 ? 'overlay' : mode
  let finalBytes: Uint8Array | null = null

  if (pixelSafePages.size > 0) {
    try {
      const candidate = await buildCandidate(mupdf, sourceBytes, boxes, pixelSafePages)
      const validation = validateRedactedBytes(mupdf, candidate, pageCount, referenceInk)
      if (validation.ok) {
        finalBytes = candidate
      } else {
        // Interruttore d'emergenza: l'output è compromesso, si scarta.
        log.error('pdfGenerator: validazione post-scrittura fallita, output scartato', {
          reason: validation.reason,
          inkFraction: validation.inkFraction,
          expectedPages: pageCount
        })
      }
    } catch (err) {
      log.error('pdfGenerator: redazione pixel fallita, ripiego su overlay', {
        code: err instanceof Error ? err.name : 'unknown'
      })
    }
  }

  // ── 4. Ripiego: nessun azzeramento dei pixel, solo rimozione del testo + overlay
  if (finalBytes === null) {
    fellBackToOverlay = true
    effectiveMode = 'overlay'
    try {
      const candidate = await buildCandidate(mupdf, sourceBytes, boxes, new Set<number>())
      const validation = validateRedactedBytes(mupdf, candidate, pageCount, referenceInk)
      if (validation.ok) finalBytes = candidate
      else {
        log.error('pdfGenerator: anche il ripiego MuPDF non valida, uso il solo overlay pdf-lib', {
          reason: validation.reason
        })
      }
    } catch (err) {
      log.error('pdfGenerator: ripiego MuPDF fallito', {
        code: err instanceof Error ? err.name : 'unknown'
      })
    }
  }

  // ── 5. Ultima rete: overlay puro sul documento originale (comportamento storico)
  if (finalBytes === null) {
    finalBytes = await drawPseudonyms(sourceBytes, boxes, 'dark')
  }

  await fs.writeFile(outputPath, finalBytes)

  const { sizeRatio, sizeWarning } = computeSizeWarning(inputSizeBytes, finalBytes.length)
  log.info('pdfGenerator: PDF scansionato anonimizzato', {
    redactionMode: effectiveMode,
    fellBackToOverlay,
    pages: pageCount,
    pagesRedacted: touchedPages.size,
    pagesPixelSafe: pixelSafePages.size,
    entitiesReplaced,
    ocrDpi: mode === 'pixels-from-ocr' ? ocrDpi : null,
    sizeRatio: Number(sizeRatio.toFixed(2)),
    sizeWarning
  })

  return {
    outputPath,
    entitiesReplaced,
    redactionMode: effectiveMode,
    sizeRatio,
    sizeWarning,
    fellBackToOverlay
  }
}

// Helper storici mantenuti soltanto per i test di migrazione. Gli entry point di
// produzione chiamano esclusivamente la pipeline fail-closed sopra.
void generatePdfDigital
void generateScannedPdf

/**
 * Produce i byte candidati completi: redazione MuPDF + pseudonimi disegnati sopra.
 * La validazione lavora su QUESTI byte, cioè esattamente quelli che finirebbero su
 * disco — non su uno stadio intermedio.
 */
async function buildCandidate(
  mupdf: Mupdf,
  sourceBytes: Uint8Array,
  boxes: RedactionBox[],
  pixelSafePages: Set<number>
): Promise<Uint8Array> {
  const redacted = await buildRedactedOutput(mupdf, sourceBytes, boxes, pixelSafePages)
  return drawPseudonyms(redacted, boxes, 'dark')
}

/**
 * Applica le annotazioni Redact e salva.
 *
 * `pixelSafePages` elenca le pagine su cui si può usare REDACT_IMAGE_PIXELS; sulle
 * altre si usa REDACT_IMAGE_NONE, che comunque **rimuove il layer di testo OCR** —
 * già un miglioramento rispetto al semplice overlay.
 */
async function buildRedactedOutput(
  mupdf: Mupdf,
  sourceBytes: Uint8Array,
  boxes: RedactionBox[],
  pixelSafePages: Set<number>
): Promise<Uint8Array> {
  const doc = new mupdf.PDFDocument(sourceBytes)

  const boxesByPage = groupByPage(boxes)
  for (const [pageIndex, pageBoxes] of boxesByPage) {
    const page = doc.loadPage(pageIndex)
    let applied = 0

    for (const box of pageBoxes) {
      const annot = page.createAnnotation('Redact')
      annot.setRect([box.x0, box.y0, box.x1, box.y1])
      annot.setContents(box.pseudo)
      annot.update()
      applied += 1
    }

    if (applied > 0) {
      const imageMethod = pixelSafePages.has(pageIndex)
        ? mupdf.PDFPage.REDACT_IMAGE_PIXELS
        : mupdf.PDFPage.REDACT_IMAGE_NONE
      page.applyRedactions(false, imageMethod)
      page.update()
    }

    // /Thumb, XMP /Metadata e /PieceInfo NON vengono toccati dalla redazione: una
    // miniatura può conservare la pagina pre-redazione. Si cancellano esplicitamente.
    scrubPageMetadata(page)
  }

  scrubCatalogMetadata(doc)

  // `asUint8Array()` è una vista viva sulla heap WASM: si stacca in silenzio appena la
  // heap cresce. Va copiata subito.
  return copyOut(doc.saveToBuffer('garbage=compact,incremental=no').asUint8Array())
}

function scrubPageMetadata(page: MupdfPage): void {
  try {
    const obj = page.getObject()
    for (const key of ['Thumb', 'Metadata', 'PieceInfo']) {
      if (!obj.get(key).isNull()) obj.delete(key)
    }
  } catch {
    // Un dizionario pagina non scrivibile non deve far fallire l'anonimizzazione.
  }
}

function scrubCatalogMetadata(doc: import('mupdf').PDFDocument): void {
  try {
    const root = doc.getTrailer().get('Root')
    if (root.isNull() || !root.isDictionary()) return
    for (const key of ['Metadata', 'PieceInfo']) {
      if (!root.get(key).isNull()) root.delete(key)
    }
  } catch {
    // idem
  }
}

// ============================================================================
// Raccolta dei box
// ============================================================================

/** Percorso veloce: i quad vengono dal layer di testo OCR già certificato allineato. */
function collectBoxesFromTextLayer(
  mupdf: Mupdf,
  sourceBytes: Uint8Array,
  confirmed: DetectedEntity[]
): RedactionBox[] {
  const doc = new mupdf.PDFDocument(sourceBytes)
  const boxes: RedactionBox[] = []

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    const pageWidth = bounds[2] - bounds[0]
    const pageHeight = bounds[3] - bounds[1]

    for (const entity of confirmed) {
      for (const quads of page.search(entity.originalText)) {
        const [x0, y0, x1, y1] = quadsToBbox(quads)
        const rect: PointRect = { x0, y0, x1, y1 }
        if (!isRedactionAreaAcceptable(rect, pageWidth, pageHeight)) {
          logRejectedRect(i, rect, pageWidth, pageHeight)
          continue
        }
        boxes.push({ page: i, x0, y0, x1, y1, pageHeight, pseudo: entity.pseudonym })
      }
    }
  }
  return boxes
}

/**
 * Percorso lento: rendering + Tesseract, box parola auto-consistenti per costruzione.
 * Il DPI arriva dall'esterno e viene usato in ENTRAMBE le direzioni della conversione.
 */
async function collectBoxesFromOcr(
  mupdf: Mupdf,
  sourceBytes: Uint8Array,
  confirmed: DetectedEntity[],
  ocrDpi: number
): Promise<RedactionBox[]> {
  const { createWorker } = await import('tesseract.js')

  const scale = dpiToScale(ocrDpi)
  const tessDataDir = getTessdataPath()
  const trainedDataBuffer = await fs.readFile(join(tessDataDir, 'ita.traineddata'))
  const langData: import('tesseract.js').Lang = { code: 'ita', data: trainedDataBuffer as unknown }

  const _require = createRequire(import.meta.url)
  const workerPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules',
        'tesseract.js/src/worker-script/node/index.js')
    : _require.resolve('tesseract.js/src/worker-script/node/index.js')

  const worker = await createWorker([langData], 1, {
    workerPath,
    cacheMethod: 'none' as const,
    gzip: false,
    errorHandler: (err: unknown) => { /* silenzioso — già gestito nel catch */ void err },
  })

  const doc = new mupdf.PDFDocument(sourceBytes)
  const pageCount = doc.countPages()
  const boxes: RedactionBox[] = []
  const tempFiles: string[] = []

  try {
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i)
      const bounds = page.getBounds()
      const pageWidth = bounds[2] - bounds[0]
      const pageHeight = bounds[3] - bounds[1]

      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false)
      const pngBuffer = Buffer.from(pixmap.asPNG())
      pixmap.destroy()

      // File temporaneo: nome casuale in directory temp di sistema, rimosso nel finally
      // (CLAUDE.md §7).
      const tempPath = join(tmpdir(), `ocr_redact_${randomBytes(8).toString('hex')}.png`)
      await fs.writeFile(tempPath, pngBuffer)
      tempFiles.push(tempPath)

      // La seconda passata OCR è stata rimossa in v1.7. Questo helper storico non è
      // raggiungibile dagli entry point; se venisse riattivato per errore deve fallire
      // chiuso invece di riconoscere nuovamente il documento.
      const result = (() => {
        throw new Error('Seconda passata OCR disabilitata: usare l’artefatto token-bound.')
      })()

      const words = flattenOcrWords(result)

      // PRIVACY: si logga solo il CONTEGGIO. Le parole riconosciute sono contenuto
      // documentale e non devono comparire nei log nemmeno in debug (CLAUDE.md §6).
      log.info('pdfGenerator: OCR di redazione', { page: i + 1, wordCount: words.length, ocrDpi })

      for (const match of matchEntitiesInWords(words, confirmed)) {
        const rect = pixelBoxToPdfPoints(match.pixelRect, ocrDpi, bounds[0], bounds[1])
        if (!isRedactionAreaAcceptable(rect, pageWidth, pageHeight)) {
          logRejectedRect(i, rect, pageWidth, pageHeight)
          continue
        }
        boxes.push({
          page: i,
          x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1,
          pageHeight,
          pseudo: match.pseudo
        })
      }
    }
  } finally {
    await worker.terminate()
    for (const f of tempFiles) {
      await fs.unlink(f).catch(() => { /* ignora */ })
    }
  }

  return boxes
}

/** Parola OCR: testo + box in pixel del rendering. */
export interface OcrWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

function flattenOcrWords(result: Awaited<ReturnType<import('tesseract.js').Worker['recognize']>>): OcrWord[] {
  const words: OcrWord[] = []
  for (const block of result.data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word.text.trim()) words.push({ text: word.text, bbox: word.bbox })
        }
      }
    }
  }
  return words
}

/** Rimuove punteggiatura esterna e normalizza spazi/maiuscole. */
function normalizeToken(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

export interface OcrMatch {
  pixelRect: PointRect
  pseudo: string
}

/**
 * Cerca le entità confermate fra le parole OCR, unendo parole consecutive sulla stessa
 * riga. Esportata per poter essere testata senza Tesseract.
 */
export function matchEntitiesInWords(
  words: readonly OcrWord[],
  confirmed: readonly DetectedEntity[]
): OcrMatch[] {
  const matches: OcrMatch[] = []

  for (const entity of confirmed) {
    const searchText = normalizeToken(entity.originalText)
    if (!searchText) continue

    for (let w = 0; w < words.length; w++) {
      let phrase = ''
      let wEnd = w
      const firstWordCenterY = (words[w].bbox.y0 + words[w].bbox.y1) / 2

      for (let j = w; j < words.length && phrase.length <= searchText.length + 10; j++) {
        const wordNorm = normalizeToken(words[j].text)
        if (!wordNorm) continue
        // Salta se la parola è su una riga diversa (centro Y distante più di 1.5x altezza)
        const wordCenterY = (words[j].bbox.y0 + words[j].bbox.y1) / 2
        const wordHeight = words[j].bbox.y1 - words[j].bbox.y0
        if (Math.abs(wordCenterY - firstWordCenterY) > wordHeight * 1.5) break
        phrase = phrase ? phrase + ' ' + wordNorm : wordNorm

        if (phrase === searchText) {
          const matchWords = words.slice(w, j + 1)
          matches.push({
            pixelRect: {
              x0: Math.min(...matchWords.map((wd) => wd.bbox.x0)),
              y0: Math.min(...matchWords.map((wd) => wd.bbox.y0)),
              x1: Math.max(...matchWords.map((wd) => wd.bbox.x1)),
              y1: Math.max(...matchWords.map((wd) => wd.bbox.y1))
            },
            pseudo: entity.pseudonym
          })
          wEnd = j
          break
        }
      }
      w = wEnd
    }
  }

  return matches
}

function logRejectedRect(pageIndex: number, rect: PointRect, pageWidth: number, pageHeight: number): void {
  const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0)
  const pageArea = pageWidth * pageHeight
  log.warn('pdfGenerator: rettangolo di redazione rifiutato (troppo grande)', {
    page: pageIndex + 1,
    areaRatio: pageArea > 0 ? Number((area / pageArea).toFixed(3)) : null,
    limit: MAX_REDACTION_AREA_RATIO
  })
}

// ============================================================================
// Validazione post-scrittura — l'interruttore d'emergenza
// ============================================================================

export type ValidationReason =
  | 'ok'
  | 'unreadable'
  | 'page-count-mismatch'
  | 'render-failed'
  | 'page-blanked'
  | 'page-blackened'

export interface OutputValidation {
  ok: boolean
  reason: ValidationReason
  inkFraction: number | null
}

/**
 * Riapre i byte prodotti e verifica che siano un PDF sano.
 *
 * Costa circa 50 ms e trasforma un difetto distruttivo in un degrado controllato: senza
 * questa verifica staremmo spedendo ad avvocati una modifica irreversibile senza via
 * d'uscita. La validazione avviene sui byte PRIMA della scrittura su disco, così un
 * output compromesso non arriva mai a sostituire nulla.
 */
export function validateRedactedBytes(
  mupdf: Mupdf,
  bytes: Uint8Array,
  expectedPages: number,
  referenceInk: number | null
): OutputValidation {
  let doc: import('mupdf').PDFDocument
  try {
    doc = new mupdf.PDFDocument(bytes)
  } catch {
    return { ok: false, reason: 'unreadable', inkFraction: null }
  }

  let pages = 0
  try {
    pages = doc.countPages()
  } catch {
    return { ok: false, reason: 'unreadable', inkFraction: null }
  }
  if (pages !== expectedPages) {
    return { ok: false, reason: 'page-count-mismatch', inkFraction: null }
  }

  const ink = firstPageInkFraction(mupdf, doc)
  if (ink === null) return { ok: false, reason: 'render-failed', inkFraction: null }

  // Pagina annerita: la redazione ha coperto tutto.
  if (ink > VALIDATION_INK_MAX) return { ok: false, reason: 'page-blackened', inkFraction: ink }

  // Pagina svuotata: c'era inchiostro e ora non c'è più nulla. Se la prima pagina era
  // già quasi bianca in origine, zero inchiostro non è un sintomo.
  if (referenceInk !== null && referenceInk > VALIDATION_INK_MIN && ink < VALIDATION_INK_MIN) {
    return { ok: false, reason: 'page-blanked', inkFraction: ink }
  }

  return { ok: true, reason: 'ok', inkFraction: ink }
}

/** Frazione di pixel scuri sulla prima pagina, renderizzata a 72 DPI (scala 1). */
function firstPageInkFraction(mupdf: Mupdf, doc: import('mupdf').PDFDocument): number | null {
  try {
    if (doc.countPages() === 0) return null
    const page = doc.loadPage(0)
    const pixmap = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false, false)
    try {
      const w = pixmap.getWidth()
      const h = pixmap.getHeight()
      const stride = pixmap.getStride()
      const pixels = pixmap.getPixels()
      if (w <= 0 || h <= 0) return null
      // getPixels() è una vista viva sulla heap WASM: se si è staccata la lunghezza
      // non torna e l'istogramma sarebbe tutto a zero, cioè un falso "pagina vuota".
      if (pixels.length < stride * h) return null
      let dark = 0
      for (let y = 0; y < h; y++) {
        const base = y * stride
        for (let x = 0; x < w; x++) if (pixels[base + x] < INK_THRESHOLD) dark += 1
      }
      return dark / (w * h)
    } finally {
      pixmap.destroy()
    }
  } catch {
    return null
  }
}

// ============================================================================
// Disegno degli pseudonimi (pdf-lib)
// ============================================================================

/**
 * Disegna rettangolo + pseudonimo sopra ogni box.
 *
 * `style` 'light' = sfondo grigio chiaro e testo scuro (PDF nativi, comportamento
 * storico); 'dark' = rettangolo scuro e testo chiaro (scansioni, comportamento storico).
 */
async function drawPseudonyms(
  sourceBytes: Uint8Array,
  boxes: RedactionBox[],
  style: 'light' | 'dark'
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(sourceBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  const boxColor = style === 'light' ? rgb(0.92, 0.92, 0.92) : rgb(0.15, 0.15, 0.15)
  const textColor = style === 'light' ? rgb(0.2, 0.2, 0.2) : rgb(0.95, 0.95, 0.95)
  const maxFontSize = style === 'light' ? 10 : 9
  const heightFactor = style === 'light' ? 0.75 : 0.65

  for (const [pageIdx, pageBoxes] of groupByPage(boxes)) {
    const page = pages[pageIdx]
    if (!page) continue

    for (const box of pageBoxes) {
      const w = box.x1 - box.x0
      const h = box.y1 - box.y0
      if (w <= 0 || h <= 0) continue

      // Conversione coordinate: MuPDF (y=0 alto, crescente verso il basso)
      //   → pdf-lib (y=0 basso, crescente verso l'alto)
      const pdfY = box.pageHeight - box.y1

      page.drawRectangle({
        x: box.x0, y: pdfY, width: w, height: h,
        color: boxColor, borderWidth: 0
      })

      const fontSize = Math.min(Math.max(h * heightFactor, 5), maxFontSize)
      const textWidth = font.widthOfTextAtSize(box.pseudo, fontSize)
      page.drawText(box.pseudo, {
        x: box.x0 + Math.max((w - textWidth) / 2, 0),
        y: pdfY + (h - fontSize) / 2,
        size: fontSize, font, color: textColor
      })
    }
  }

  return pdfDoc.save()
}

// ============================================================================
// Utilità
// ============================================================================

function groupByPage(boxes: RedactionBox[]): Map<number, RedactionBox[]> {
  const byPage = new Map<number, RedactionBox[]>()
  for (const box of boxes) {
    const list = byPage.get(box.page)
    if (list) list.push(box)
    else byPage.set(box.page, [box])
  }
  return byPage
}

/** Copia fuori dalla heap WASM: la vista restituita da MuPDF si stacca senza preavviso. */
function copyOut(view: Uint8Array): Uint8Array {
  return Uint8Array.from(view)
}

function quadsToBbox(quads: number[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const q of quads) {
    for (let i = 0; i < 8; i += 2) {
      x0 = Math.min(x0, q[i])
      x1 = Math.max(x1, q[i])
      y0 = Math.min(y0, q[i + 1])
      y1 = Math.max(y1, q[i + 1])
    }
  }
  return [x0, y0, x1, y1]
}
