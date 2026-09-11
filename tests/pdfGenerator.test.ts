import { describe, expect, it, vi } from 'vitest'
import { copyFile, mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import type { DetectedEntity } from '../src/shared/types'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
    isPackaged: false,
  },
}))

import { generatePdf, generatePdfFromImage } from '../src/main/outputGenerators/pdfGenerator'
import { generateOutput } from '../src/main/outputGenerators/index'

const FIXTURES = join(__dirname, 'fixtures')
const CORPUS_IMG = join(__dirname, 'corpus-ocr', 'immagine')

function entity(originalText = 'Mario Rossi', pseudonym = 'PERSONA_1'): DetectedEntity {
  return {
    id: randomUUID(),
    type: 'PERSONA',
    originalText,
    pseudonym,
    occurrences: 1,
    confirmed: true,
  }
}

async function tempFixture(fixturePath: string): Promise<{ input: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'anonimator-pdf-entry-'))
  const input = join(dir, 'documento.pdf')
  await copyFile(fixturePath, input)
  return { input, dir }
}

async function loadMupdf() {
  return (await import('mupdf')).default
}

function documentText(doc: import('mupdf').PDFDocument): string {
  const pages: string[] = []
  for (let index = 0; index < doc.countPages(); index++) {
    pages.push(doc.loadPage(index).toStructuredText('preserve-whitespace').asText())
  }
  return pages.join('\n')
}

describe('façade PDF pubblico', () => {
  it('il routing digital rimuove i glifi originali e inserisce lo pseudonimo', async () => {
    const mupdf = await loadMupdf()
    const { input, dir } = await tempFixture(join(FIXTURES, 'sample.pdf'))
    try {
      const result = await generatePdf(input, [entity()], {
        routing: 'digital',
        layerKind: 'digital',
      })
      expect(result.redactionMode).toBe('digital')
      expect(result.entitiesReplaced).toBe(1)

      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(documentText(output)).not.toContain('Mario Rossi')
        expect(documentText(output)).toContain('PERSONA_1')
      } finally {
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rispetta il routing flattened esplicito anche con un layer digitale', async () => {
    const mupdf = await loadMupdf()
    const { input, dir } = await tempFixture(join(FIXTURES, 'sample.pdf'))
    try {
      const result = await generatePdf(input, [entity()], {
        routing: 'flattened-scan',
        layerKind: 'digital',
      })
      const source = new mupdf.PDFDocument(new Uint8Array(await readFile(input)))
      const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
      try {
        expect(result.redactionMode).toBe('flattened-scan')
        expect(output.countPages()).toBe(source.countPages())
        expect(documentText(output)).not.toContain('Mario Rossi')
      } finally {
        source.destroy()
        output.destroy()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('ricostruisce SMask e Indexed senza riusare oggetti del documento sorgente', async () => {
    const mupdf = await loadMupdf()
    for (const fixture of ['img-11-smask.pdf', 'img-12-indexed.pdf']) {
      const { input, dir } = await tempFixture(join(CORPUS_IMG, fixture))
      try {
        const result = await generatePdf(input, [entity()], {
          routing: 'flattened-scan',
          layerKind: 'scan-with-text',
          ocrAligned: true,
        })
        const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.outputPath)))
        try {
          expect(result.redactionMode, fixture).toBe('flattened-scan')
          expect(result.entitiesReplaced, fixture).toBe(1)
          const annots = output.loadPage(0).getObject().get('Annots')
          expect(annots.isNull() || (annots.isArray() && annots.length === 0), fixture).toBe(true)
        } finally {
          output.destroy()
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  }, 60_000)

  it('espone diagnostica di dimensione per una sorgente CCITT G4', async () => {
    const { input, dir } = await tempFixture(join(CORPUS_IMG, 'img-14-g4-grande.pdf'))
    try {
      const result = await generatePdf(input, [entity()], {
        routing: 'flattened-scan',
        layerKind: 'scan-with-text',
        ocrAligned: true,
      })
      expect(result.sizeRatio).toBeGreaterThan(0)
      expect(typeof result.sizeWarning).toBe('boolean')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('confine fail-closed del façade', () => {
  it('senza artefatto OCR token-bound non scrive output per una scansione non attendibile', async () => {
    const { input, dir } = await tempFixture(join(CORPUS_IMG, 'img-13-xobject-condiviso.pdf'))
    try {
      await expect(generatePdf(input, [entity()], {
        routing: 'flattened-scan',
        layerKind: 'scan-no-text',
        ocrAligned: false,
      })).rejects.toMatchObject({ code: 'ocr-artifact-missing' })
      expect((await readdir(dir)).filter((name) => name.includes('_anonimizzato'))).toEqual([])
      expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('senza artefatto OCR token-bound non scrive output dall’entry point immagini', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anonimator-image-entry-'))
    const input = join(dir, 'immagine-sintetica.png')
    await sharp({ create: { width: 320, height: 200, channels: 3, background: '#ffffff' } })
      .png()
      .toFile(input)
    try {
      await expect(generatePdfFromImage(input, [entity()]))
        .rejects.toMatchObject({ code: 'ocr-artifact-missing' })
      expect((await readdir(dir)).filter((name) => name.includes('_anonimizzato'))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('routing ricavato da generateOutput', () => {
  it('una scansione senza opzioni esplicite non passa dal percorso digital', async () => {
    const { input, dir } = await tempFixture(join(CORPUS_IMG, 'img-13-xobject-condiviso.pdf'))
    try {
      const result = await generateOutput(input, 'pdf', [entity()], {})
      expect(result.redactionMode).toBe('flattened-scan')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('un PDF nativo resta digital', async () => {
    const { input, dir } = await tempFixture(join(FIXTURES, 'sample.pdf'))
    try {
      const result = await generateOutput(input, 'pdf', [entity()], {})
      expect(result.redactionMode).toBe('digital')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
