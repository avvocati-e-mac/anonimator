import { describe, expect, it } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { PDFDocument, rgb } from 'pdf-lib'
import {
  SearchableLayerError,
  applySearchableLayer,
  type SearchableLayerArtifact,
} from '../src/main/services/searchableLayer'

const FONT = join(__dirname, '..', 'build-resources', 'fonts', 'NotoSans-v2.015', 'NotoSans-Regular.ttf')

async function rasterFixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  // Simula metadata sorgente ostili: il layer deve rimuoverli dal nuovo output.
  document.setTitle('Mario Rossi')
  const page = document.addPage([300, 200])
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: rgb(1, 1, 1) })
  page.drawRectangle({ x: 20, y: 120, width: 190, height: 25, color: rgb(0.15, 0.15, 0.15) })
  return document.save({ useObjectStreams: false })
}

function artifact(): SearchableLayerArtifact {
  return {
    pages: [{
      page: 0,
      pageBounds: [0, 0, 300, 200],
      renderMatrix: [1, 0, 0, 1, 0, 0],
      pixmapOrigin: { x: 0, y: 0 },
      words: [
        { text: 'Il', bbox: { x0: 20, y0: 55, x1: 35, y1: 75 }, confidence: 96, line: 0 },
        { text: 'Mario', bbox: { x0: 45, y0: 55, x1: 100, y1: 75 }, confidence: 94, line: 0 },
        { text: 'Rossi', bbox: { x0: 105, y0: 55, x1: 160, y1: 75 }, confidence: 95, line: 0 },
        { text: 'è', bbox: { x0: 165, y0: 55, x1: 175, y1: 75 }, confidence: 91, line: 0 },
        { text: 'presente', bbox: { x0: 180, y0: 55, x1: 250, y1: 75 }, confidence: 93, line: 0 },
      ],
    }],
    sensitiveSequences: [{ entityId: 'person-1', page: 0, wordStart: 1, wordEnd: 2, pseudonym: 'PERSONA_1' }],
  }
}

async function mupdfText(bytes: Uint8Array): Promise<string> {
  const mupdf = (await import('mupdf')).default
  const document = new mupdf.PDFDocument(bytes)
  try { return document.loadPage(0).toStructuredText('preserve-whitespace').asText() }
  finally { document.destroy() }
}

async function contentStreams(bytes: Uint8Array): Promise<string> {
  const mupdf = (await import('mupdf')).default
  const document = new mupdf.PDFDocument(bytes)
  try {
    const contents = document.loadPage(0).getObject().get('Contents')
    if (contents.isArray()) {
      let text = ''
      for (let index = 0; index < contents.length; index++) text += contents.get(index).readStream().asString()
      return text
    }
    return contents.readStream().asString()
  } finally { document.destroy() }
}

async function renderedPixels(bytes: Uint8Array): Promise<Uint8Array> {
  const mupdf = (await import('mupdf')).default
  const document = new mupdf.PDFDocument(bytes)
  const pixmap = document.loadPage(0).toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, true)
  try { return Uint8Array.from(pixmap.getPixels()) }
  finally { pixmap.destroy(); document.destroy() }
}

describe('applySearchableLayer', () => {
  it('lascia un output partial byte-per-byte e reference-identical', async () => {
    const rasterPdfBytes = await rasterFixture()
    const output = await applySearchableLayer({
      rasterPdfBytes,
      safetyStatus: 'partial',
      artifact: { pages: [], sensitiveSequences: [] },
      notoSansBytes: new Uint8Array(),
    })
    expect(output).toBe(rasterPdfBytes)
  })

  it('usa Tr 3, rende ricercabile lo pseudonimo e non codifica l originale', async () => {
    const rasterPdfBytes = await rasterFixture()
    const notoSansBytes = new Uint8Array(await readFile(FONT))
    const output = await applySearchableLayer({ rasterPdfBytes, safetyStatus: 'complete', artifact: artifact(), notoSansBytes })

    const stream = await contentStreams(output)
    expect(stream).toMatch(/\b3\s+Tr\b/)
    expect(stream).not.toMatch(/\b0\s+Tr\b/)
    const extracted = await mupdfText(output)
    expect(extracted).toContain('PERSONA_1')
    expect(extracted).toContain('presente')
    expect(extracted).not.toContain('Mario')
    expect(extracted).not.toContain('Rossi')
    expect(Buffer.from(output).includes(Buffer.from('Mario Rossi'))).toBe(false)
    const reopened = await PDFDocument.load(output, { updateMetadata: false })
    expect(reopened.getTitle()).toBe('')
    expect(Buffer.from(output).toString('latin1')).toContain('/BaseFont /NotoSans')

    expect(await renderedPixels(output)).toEqual(await renderedPixels(rasterPdfBytes))
  }, 20_000)

  it('rifiuta artefatti incompleti o range sensibili sovrapposti', async () => {
    const rasterPdfBytes = await rasterFixture()
    const notoSansBytes = new Uint8Array(await readFile(FONT))
    await expect(applySearchableLayer({
      rasterPdfBytes, safetyStatus: 'complete', notoSansBytes,
      artifact: { pages: [], sensitiveSequences: [] },
    })).rejects.toBeInstanceOf(SearchableLayerError)

    const overlapping = artifact()
    overlapping.sensitiveSequences = [
      ...overlapping.sensitiveSequences,
      { entityId: 'second', page: 0, wordStart: 2, wordEnd: 3, pseudonym: 'PERSONA_2' },
    ]
    await expect(applySearchableLayer({
      rasterPdfBytes, safetyStatus: 'complete', notoSansBytes, artifact: overlapping,
    })).rejects.toThrow('sovrapposte')
  })
})
