import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFName,
} from 'pdf-lib'
import type { SaveResult } from '@shared/types'
import { renderedPixelRectToMupdf, type AffineMatrix, type Rect } from './geometry'

export interface SearchableOcrWord {
  text: string
  bbox: Rect
  confidence: number
  line: number
  /** Orientamento del testo nel raster canonico. Default: 0. */
  rotationDegrees?: number
}

export interface SearchableOcrPage {
  /** Indice pagina zero-based. */
  page: number
  /** Bounds MuPDF della pagina usata per produrre il raster. */
  pageBounds: readonly [number, number, number, number]
  renderMatrix: AffineMatrix
  pixmapOrigin: { x: number; y: number }
  words: readonly SearchableOcrWord[]
}

export interface SensitiveWordSequence {
  /** ID opaco, utile al chiamante per correlare il ledger. */
  entityId: string
  page: number
  wordStart: number
  /** Indice incluso. */
  wordEnd: number
  pseudonym: string
}

export interface SearchableLayerArtifact {
  pages: readonly SearchableOcrPage[]
  sensitiveSequences: readonly SensitiveWordSequence[]
}

export interface ApplySearchableLayerInput {
  rasterPdfBytes: Uint8Array
  safetyStatus: SaveResult['safetyStatus']
  artifact: SearchableLayerArtifact
  /** NotoSans-Regular.ttf. Il caricamento da disco resta responsabilità del Main. */
  notoSansBytes: Uint8Array
}

export class SearchableLayerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchableLayerError'
  }
}

interface TextEmission {
  text: string
  box: Rect
  rotationDegrees: number
}

/**
 * Aggiunge un layer OCR realmente invisibile (`Tr 3`) soltanto a un output completo.
 * Per un risultato partial restituisce intenzionalmente lo stesso buffer, senza
 * aprire o risalvare il PDF raster-only.
 */
export async function applySearchableLayer(input: ApplySearchableLayerInput): Promise<Uint8Array> {
  if (input.safetyStatus !== 'complete') return input.rasterPdfBytes
  if (input.notoSansBytes.byteLength === 0) throw new SearchableLayerError('Noto Sans non disponibile.')

  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(input.rasterPdfBytes, { updateMetadata: false })
  } catch {
    throw new SearchableLayerError('PDF raster non leggibile.')
  }

  validateArtifact(input.artifact, pdf.getPageCount())
  // Una registrazione e un embedding per documento, esplicitamente senza subsetting.
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(input.notoSansBytes, { subset: false })

  const sequencesByPage = groupSequences(input.artifact.sensitiveSequences)
  for (const artifactPage of input.artifact.pages) {
    const page = pdf.getPage(artifactPage.page)
    const emissions = buildEmissions(artifactPage, sequencesByPage.get(artifactPage.page) ?? [])
    // Registra il riferimento nelle Resources e usa la chiave effettivamente allocata
    // (puo' avere un suffisso se il nome era gia' presente).
    if (emissions.length > 0) {
      const fontResourceName = page.node.newFontDictionary(font.name, font.ref)
      for (const emission of emissions) addInvisibleText(page, font, fontResourceName, emission)
    }
  }

  // Il raster v1.6 nasce gia' senza metadata sorgente. Si azzerano comunque i campi
  // testuali liberi affinche' questo servizio non possa conservarne accidentalmente.
  pdf.setTitle('')
  pdf.setAuthor('')
  pdf.setSubject('')
  pdf.setKeywords([])
  pdf.setCreator('Anonimator')
  pdf.setProducer('Anonimator')
  return pdf.save({ useObjectStreams: false })
}

function validateArtifact(artifact: SearchableLayerArtifact, pageCount: number): void {
  if (artifact.pages.length !== pageCount) {
    throw new SearchableLayerError('Artefatto OCR incompleto: manca una pagina.')
  }
  const pages = new Set<number>()
  for (const page of artifact.pages) {
    if (!Number.isInteger(page.page) || page.page < 0 || page.page >= pageCount || pages.has(page.page)) {
      throw new SearchableLayerError('Indice pagina OCR non valido o duplicato.')
    }
    pages.add(page.page)
    const [x0, y0, x1, y1] = page.pageBounds
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
      throw new SearchableLayerError('Bounds pagina OCR non validi.')
    }
    for (const word of page.words) {
      if (!word.text || !Number.isFinite(word.confidence) || !Number.isInteger(word.line)) {
        throw new SearchableLayerError('Parola OCR non valida.')
      }
    }
  }

  for (const sequence of artifact.sensitiveSequences) {
    const page = artifact.pages.find((candidate) => candidate.page === sequence.page)
    if (!page || !sequence.pseudonym.trim() || !Number.isInteger(sequence.wordStart)
      || !Number.isInteger(sequence.wordEnd) || sequence.wordStart < 0
      || sequence.wordEnd < sequence.wordStart || sequence.wordEnd >= page.words.length) {
      throw new SearchableLayerError('Sequenza sensibile non valida.')
    }
  }
}

function groupSequences(sequences: readonly SensitiveWordSequence[]): Map<number, SensitiveWordSequence[]> {
  const result = new Map<number, SensitiveWordSequence[]>()
  for (const sequence of sequences) {
    const page = result.get(sequence.page)
    if (page) page.push(sequence)
    else result.set(sequence.page, [sequence])
  }
  for (const page of result.values()) page.sort((left, right) => left.wordStart - right.wordStart)
  return result
}

function buildEmissions(page: SearchableOcrPage, sequences: readonly SensitiveWordSequence[]): TextEmission[] {
  const owner = new Array<number>(page.words.length).fill(-1)
  sequences.forEach((sequence, sequenceIndex) => {
    for (let word = sequence.wordStart; word <= sequence.wordEnd; word++) {
      if (owner[word] !== -1) throw new SearchableLayerError('Sequenze sensibili sovrapposte.')
      owner[word] = sequenceIndex
    }
  })

  const emissions: TextEmission[] = []
  for (let wordIndex = 0; wordIndex < page.words.length; wordIndex++) {
    const sequenceIndex = owner[wordIndex]
    if (sequenceIndex === -1) {
      const word = page.words[wordIndex]
      emissions.push({
        text: word.text,
        box: pixelBoxToPdfBox(page, word.bbox),
        rotationDegrees: word.rotationDegrees ?? 0,
      })
      continue
    }
    const sequence = sequences[sequenceIndex]
    if (wordIndex !== sequence.wordStart) continue
    const boxes = page.words.slice(sequence.wordStart, sequence.wordEnd + 1).map((word) => word.bbox)
    emissions.push({
      // Solo lo pseudonimo viene codificato. Le parole sensibili non raggiungono
      // encodeText, content stream o strutture ToUnicode.
      text: sequence.pseudonym,
      box: pixelBoxToPdfBox(page, union(boxes)),
      rotationDegrees: page.words[sequence.wordStart].rotationDegrees ?? 0,
    })
  }
  return emissions
}

function pixelBoxToPdfBox(page: SearchableOcrPage, pixelBox: Rect): Rect {
  const mupdf = renderedPixelRectToMupdf(pixelBox, page.renderMatrix, page.pixmapOrigin)
  const [pageX0, pageY0, pageX1, pageY1] = page.pageBounds
  const width = pageX1 - pageX0
  const height = pageY1 - pageY0
  return {
    x0: mupdf.x0 - pageX0,
    y0: height - (mupdf.y1 - pageY0),
    x1: Math.min(width, mupdf.x1 - pageX0),
    y1: height - (mupdf.y0 - pageY0),
  }
}

function union(boxes: readonly Rect[]): Rect {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  }
}

function addInvisibleText(
  page: ReturnType<PDFDocument['getPage']>,
  font: PDFFont,
  fontResourceName: PDFName,
  emission: TextEmission,
): void {
  const width = emission.box.x1 - emission.box.x0
  const height = emission.box.y1 - emission.box.y0
  if (!emission.text || width <= 0 || height <= 0) throw new SearchableLayerError('Box testo non valido.')

  const angle = Number.isFinite(emission.rotationDegrees) ? emission.rotationDegrees : 0
  const radians = angle * Math.PI / 180
  const vertical = Math.abs(Math.sin(radians)) > Math.abs(Math.cos(radians))
  const availableAdvance = vertical ? height : width
  const availableHeight = vertical ? width : height
  const unitWidth = font.widthOfTextAtSize(emission.text, 1)
  if (!(unitWidth > 0)) throw new SearchableLayerError('Testo OCR non codificabile.')
  const size = Math.max(0.1, Math.min(availableHeight * 0.82, availableAdvance / unitWidth))
  const x = emission.box.x0
  const y = emission.box.y0 + Math.max(0, (height - size) / 2)

  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(fontResourceName, size),
    setTextMatrix(Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), x, y),
    showText(font.encodeText(emission.text)),
    endText(),
    popGraphicsState(),
  )
}
