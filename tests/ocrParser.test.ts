import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { PDFDocument } from 'pdf-lib'

const ocrTestState = vi.hoisted(() => ({ tessdataDir: '' }))
const recognizeMock = vi.hoisted(() => vi.fn())
const terminateMock = vi.hoisted(() => vi.fn())
const setParametersMock = vi.hoisted(() => vi.fn())
const createWorkerMock = vi.hoisted(() => vi.fn())
const imageMetadataMock = vi.hoisted(() => vi.fn())

vi.mock('tesseract.js', () => ({
  createWorker: createWorkerMock,
}))

vi.mock('sharp', () => ({
  default: vi.fn(() => ({ metadata: imageMetadataMock })),
}))

// Mock electron — non c'è finestra Electron in vitest (stesso pattern di pdfParser.test.ts).
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/test-userdata' }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// nerService è un modulo pesante (Transformers.js, LLM, sessionManager...): ocrParser
// ne importa solo getTessdataPath, quindi lo si mocka per non trascinarsi dietro tutto
// il grafo di dipendenze in un test che deve restare rapido e deterministico.
vi.mock('../src/main/services/nerService', () => ({
  getTessdataPath: vi.fn(() => ocrTestState.tessdataDir)
}))

import {
  OCR_CONFIDENCE_THRESHOLD,
  buildImageLowConfidenceWarning,
  buildImagePixelMatrix,
  buildOcrRenderMatrix,
  buildPdfLowConfidenceWarning,
  extractOcrArtifactWords,
  isLowConfidence,
  parseImage,
  parsePdfWithOcr,
  resolveRenderDpi
} from '../src/main/parsers/ocrParser'
import { getOcrArtifact, ocrArtifactCache } from '../src/main/services/ocrArtifactCache'
import {
  OCR_RENDER_DPI_DEFAULT,
  OCR_RENDER_DPI_MAX,
  OCR_RENDER_DPI_MIN,
  dpiToScale,
  resolveOcrDpi
} from '../src/main/services/ocrRenderConfig'

beforeEach(() => {
  recognizeMock.mockReset()
  terminateMock.mockReset().mockResolvedValue(undefined)
  setParametersMock.mockReset().mockResolvedValue(undefined)
  createWorkerMock.mockReset().mockImplementation(async () => ({
    recognize: recognizeMock,
    terminate: terminateMock,
    setParameters: setParametersMock,
  }))
  imageMetadataMock.mockReset().mockResolvedValue({ width: 240, height: 100 })
  ocrArtifactCache.clear()
})

describe('artefatto OCR ridotto', () => {
  it('conserva parole, bbox, confidenza, riga e pagina senza duplicare il testo', () => {
    const words = extractOcrArtifactWords({
      text: 'Mario Rossi',
      blocks: [{ paragraphs: [{ lines: [
        { words: [{ text: 'Mario', confidence: 91, bbox: { x0: 1, y0: 2, x1: 10, y1: 12 } }] },
        { words: [{ text: 'Rossi', confidence: 87, bbox: { x0: 2, y0: 20, x1: 11, y1: 30 } }] },
      ] }] }],
    }, 3)

    expect(words).toEqual([
      { text: 'Mario', confidence: 91, bbox: { x0: 1, y0: 2, x1: 10, y1: 12 }, line: 1, page: 3 },
      { text: 'Rossi', confidence: 87, bbox: { x0: 2, y0: 20, x1: 11, y1: 30 }, line: 2, page: 3 },
    ])
  })

  it('scarta bbox degeneri o non numerici', () => {
    expect(extractOcrArtifactWords({ words: [
      { text: 'ok', confidence: 80, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
      { text: 'bad', confidence: 80, bbox: { x0: 0, y0: 0, x1: 0, y1: 5 } },
    ] }, 1)).toHaveLength(1)
  })
})

// ocrParser ha bisogno di Tesseract e di ita.traineddata per i percorsi end-to-end
// (parseImage, parsePdfWithOcr): test lenti e fragili, esclusi qui di proposito.
// Si testano solo le parti pure e deterministiche: risoluzione DPI, composizione
// della matrice di deskew, soglia di confidenza e messaggi di warning.

describe('resolveRenderDpi', () => {
  it('delega a resolveOcrDpi — nessuna costante locale', () => {
    expect(resolveRenderDpi(undefined)).toBe(OCR_RENDER_DPI_DEFAULT)
    expect(resolveRenderDpi(undefined)).toBe(resolveOcrDpi(undefined))
  })

  it('rispetta il clamp [200, 400] del contratto condiviso', () => {
    expect(resolveRenderDpi(1200)).toBe(OCR_RENDER_DPI_MAX)
    expect(resolveRenderDpi(50)).toBe(OCR_RENDER_DPI_MIN)
    expect(resolveRenderDpi(250)).toBe(250)
  })

  it('coincide con resolveOcrDpi su un campione di valori arbitrari', () => {
    for (const v of [null, undefined, 72, 150, 200, 300, 400, 600, 1000]) {
      expect(resolveRenderDpi(v ?? undefined)).toBe(resolveOcrDpi(v))
    }
  })
})

describe('geometria immagini standalone', () => {
  it('mantiene i bbox nei pixel originali indipendentemente dall’hint DPI', () => {
    expect(buildImagePixelMatrix()).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('parseImage registra davvero la matrice identità nell’artefatto token-bound', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-image-artifact-'))
    const input = join(dir, 'zxq-canary.png')
    const token = randomUUID()
    let handle: string | undefined
    ocrTestState.tessdataDir = join(dir, 'tessdata')
    recognizeMock.mockResolvedValueOnce({
      data: {
        text: 'ZXQCANARY',
        confidence: 99,
        words: [{
          text: 'ZXQCANARY',
          confidence: 99,
          bbox: { x0: 50, y0: 20, x1: 150, y1: 45 },
        }],
      },
    })

    try {
      await mkdir(ocrTestState.tessdataDir)
      await writeFile(join(ocrTestState.tessdataDir, 'ita.traineddata'), 'synthetic-test-bytes')
      await writeFile(input, 'synthetic-image-placeholder')

      const result = await parseImage(input, { dpi: 300 })
      handle = result.ocrArtifactHandle
      expect(handle).toBeDefined()
      if (!handle) throw new Error('Artefatto OCR atteso')
      ocrArtifactCache.bind(handle, token)
      handle = undefined

      expect(getOcrArtifact(token)?.pages[0]).toMatchObject({
        renderMatrix: [1, 0, 0, 1, 0, 0],
        pixmapOrigin: { x: 0, y: 0 },
        words: [{
          text: 'ZXQCANARY',
          bbox: { x0: 50, y0: 20, x1: 150, y1: 45 },
        }],
      })
    } finally {
      ocrArtifactCache.discard(handle)
      ocrArtifactCache.release(token)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rifiuta una bitmap oltre 50 MP prima di creare il worker OCR', async () => {
    imageMetadataMock.mockResolvedValueOnce({ width: 10_000, height: 5_001 })

    await expect(parseImage('/fixture/sintetica.png')).rejects.toMatchObject({
      code: 'resource-limit',
    })
    expect(createWorkerMock).not.toHaveBeenCalled()
    expect(ocrArtifactCache.stats().pending).toBe(0)
  })

  it('termina il worker se la configurazione OCR fallisce', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-worker-config-'))
    const input = join(dir, 'synthetic.png')
    ocrTestState.tessdataDir = join(dir, 'tessdata')
    setParametersMock.mockRejectedValueOnce(new Error('synthetic configuration failure'))

    try {
      await mkdir(ocrTestState.tessdataDir)
      await writeFile(join(ocrTestState.tessdataDir, 'ita.traineddata'), 'synthetic-test-bytes')
      await writeFile(input, 'synthetic-image-placeholder')

      await expect(parseImage(input, { dpi: 300 })).rejects.toMatchObject({
        code: 'ocr-unavailable',
      })
      expect(terminateMock).toHaveBeenCalledOnce()
      expect(recognizeMock).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('OCR PDF fail-closed', () => {
  async function writeSyntheticPdf(filePath: string, size: readonly [number, number]): Promise<void> {
    const document = await PDFDocument.create()
    document.addPage([...size])
    await writeFile(filePath, await document.save())
  }

  async function prepareTessdata(dir: string): Promise<void> {
    ocrTestState.tessdataDir = join(dir, 'tessdata')
    await mkdir(ocrTestState.tessdataDir)
    await writeFile(join(ocrTestState.tessdataDir, 'ita.traineddata'), 'synthetic-test-bytes')
  }

  it('non invoca MuPDF quando la pixmap prevista supera 50 MP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-ocr-budget-'))
    const input = join(dir, 'oversize.pdf')
    await prepareTessdata(dir)
    await writeSyntheticPdf(input, [2_000, 2_000])

    const mupdf = (await import('mupdf')).default
    const probeDocument = new mupdf.PDFDocument(new Uint8Array(await readFile(input)))
    const probePage = probeDocument.loadPage(0)
    const pagePrototype = Object.getPrototypeOf(probePage) as { toPixmap: (...args: unknown[]) => unknown }
    probePage.destroy()
    probeDocument.destroy()
    const renderSpy = vi.spyOn(pagePrototype, 'toPixmap').mockImplementation(() => {
      throw new Error('render must not run')
    })

    try {
      await expect(parsePdfWithOcr(input, { dpi: 300 })).rejects.toMatchObject({
        code: 'resource-limit',
      })
      expect(renderSpy).not.toHaveBeenCalled()
      expect(terminateMock).toHaveBeenCalledOnce()
      expect(ocrArtifactCache.stats().pending).toBe(0)
    } finally {
      renderSpy.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('un errore OCR non ricade sul testo digitale e non pubblica artefatti parziali', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-ocr-closed-'))
    const input = join(dir, 'blank.pdf')
    await prepareTessdata(dir)
    await writeSyntheticPdf(input, [200, 200])
    recognizeMock.mockRejectedValueOnce(new Error('synthetic recognition failure'))

    try {
      await expect(parsePdfWithOcr(input, { dpi: 200 })).rejects.toMatchObject({
        code: 'ocr-failed',
      })
      expect(terminateMock).toHaveBeenCalledOnce()
      expect(ocrArtifactCache.stats()).toMatchObject({ pending: 0, active: 0, usedBytes: 0 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('buildOcrRenderMatrix', () => {
  const dpi = 300
  const s = dpiToScale(dpi)

  it('senza skewDeg produce solo la matrice di scala (nessuna rotazione)', () => {
    expect(buildOcrRenderMatrix(dpi)).toEqual([s, 0, 0, s, 0, 0])
  })

  it('sotto la soglia di 0,5° non ruota', () => {
    expect(buildOcrRenderMatrix(dpi, 0)).toEqual([s, 0, 0, s, 0, 0])
    expect(buildOcrRenderMatrix(dpi, 0.3)).toEqual([s, 0, 0, s, 0, 0])
    expect(buildOcrRenderMatrix(dpi, -0.49)).toEqual([s, 0, 0, s, 0, 0])
  })

  it('esattamente a 0,5° la soglia scatta (>=, non solo >)', () => {
    const m = buildOcrRenderMatrix(dpi, 0.5)
    expect(m).not.toEqual([s, 0, 0, s, 0, 0])
  })

  it('angoli non finiti sono trattati come nessuna rotazione', () => {
    expect(buildOcrRenderMatrix(dpi, Number.NaN)).toEqual([s, 0, 0, s, 0, 0])
  })

  it('per un angolo noto compone scala e contro-rotazione (-skewDeg)', () => {
    const skewDeg = 4
    const rad = (-skewDeg * Math.PI) / 180
    const c = Math.cos(rad)
    const sn = Math.sin(rad)

    const m = buildOcrRenderMatrix(dpi, skewDeg)

    expect(m[0]).toBeCloseTo(s * c, 10)
    expect(m[1]).toBeCloseTo(s * sn, 10)
    expect(m[2]).toBeCloseTo(-s * sn, 10)
    expect(m[3]).toBeCloseTo(s * c, 10)
    expect(m[4]).toBe(0)
    expect(m[5]).toBe(0)
  })

  it("un'inclinazione negativa ruota nel verso opposto", () => {
    const skewDeg = -3
    const rad = (-skewDeg * Math.PI) / 180
    const m = buildOcrRenderMatrix(dpi, skewDeg)

    expect(m[0]).toBeCloseTo(s * Math.cos(rad), 10)
    expect(m[1]).toBeCloseTo(s * Math.sin(rad), 10)
    // Segno opposto rispetto al caso skewDeg positivo di pari modulo.
    const opposite = buildOcrRenderMatrix(dpi, -skewDeg)
    expect(m[1]).toBeCloseTo(-opposite[1], 10)
  })

  it('la rotazione preserva il determinante s² (nessuna distorsione di scala)', () => {
    const m = buildOcrRenderMatrix(dpi, 3)
    const det = m[0] * m[3] - m[1] * m[2]
    expect(det).toBeCloseTo(s * s, 8)
  })
})

describe('soglia di confidenza OCR e messaggi di warning', () => {
  it('isLowConfidence rispetta la soglia (< e non <=)', () => {
    expect(isLowConfidence(OCR_CONFIDENCE_THRESHOLD - 1)).toBe(true)
    expect(isLowConfidence(OCR_CONFIDENCE_THRESHOLD)).toBe(false)
    expect(isLowConfidence(100)).toBe(false)
    expect(isLowConfidence(0)).toBe(true)
  })

  it('messaggio di warning per una singola immagine', () => {
    expect(buildImageLowConfidenceWarning(42.6)).toBe(
      'Qualità OCR bassa (43%). Verificare manualmente le entità rilevate.'
    )
  })

  it('messaggio di warning aggregato per un PDF multipagina', () => {
    const msg = buildPdfLowConfidenceWarning(3)
    expect(msg).toContain('3 pagina/e')
    expect(msg).toContain(`< ${OCR_CONFIDENCE_THRESHOLD}%`)
    expect(msg).toContain('Verificare manualmente le entità rilevate.')
  })
})
