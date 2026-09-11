#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import mupdf from 'mupdf'

function fail(message) {
  throw new Error(`searchable PDF gate: ${message}`)
}

function parseArgs(argv) {
  const result = { originals: [], pseudonyms: [], status: 'complete', tolerance: 0.002 }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = argv[++i]
    if (!value) fail(`valore mancante per ${key}`)
    if (key === '--source') result.source = value
    else if (key === '--visual-reference') result.visualReference = value
    else if (key === '--output') result.output = value
    else if (key === '--original') result.originals.push(value)
    else if (key === '--pseudonym') result.pseudonyms.push(value)
    else if (key === '--status') result.status = value
    else if (key === '--pixel-tolerance') result.tolerance = Number(value)
    else fail(`argomento sconosciuto ${key}`)
  }
  if (!result.source || !result.visualReference || !result.output) {
    fail('servono --source, --visual-reference e --output')
  }
  if (!['complete', 'partial'].includes(result.status)) fail('--status deve essere complete o partial')
  if (!Number.isFinite(result.tolerance) || result.tolerance < 0 || result.tolerance > 1) {
    fail('--pixel-tolerance deve essere fra 0 e 1')
  }
  return result
}

function command(name, args, encoding = 'utf8') {
  try {
    return execFileSync(name, args, { encoding, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error.message
    fail(`${name} non disponibile o fallito: ${detail}`)
  }
}

function parsePpm(path) {
  const data = readFileSync(path)
  let offset = 0
  const token = () => {
    while (offset < data.length) {
      if (data[offset] === 0x23) while (offset < data.length && data[offset++] !== 0x0a) {}
      else if (data[offset] <= 0x20) offset++
      else break
    }
    const start = offset
    while (offset < data.length && data[offset] > 0x20) offset++
    return data.subarray(start, offset).toString('ascii')
  }
  if (token() !== 'P6') fail(`render inatteso per ${basename(path)}: atteso PPM P6`)
  const width = Number(token())
  const height = Number(token())
  if (Number(token()) !== 255) fail(`maxval PPM non supportato in ${basename(path)}`)
  while (data[offset] <= 0x20) offset++
  return { width, height, pixels: data.subarray(offset) }
}

function renderedPages(pdf, dir, prefix) {
  command('pdftoppm', ['-r', '150', pdf, join(dir, prefix)])
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.ppm'))
    .sort()
    .map((name) => parsePpm(join(dir, name)))
}

function assertVisualIdentity(reference, output, tolerance) {
  const dir = mkdtempSync(join(tmpdir(), 'anonimator-layer-visual-'))
  try {
    const expected = renderedPages(reference, dir, 'reference')
    const actual = renderedPages(output, dir, 'output')
    if (expected.length !== actual.length) fail('il numero di pagine renderizzate e cambiato')
    let changed = 0
    let samples = 0
    for (let page = 0; page < expected.length; page++) {
      const a = expected[page]
      const b = actual[page]
      if (a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length) {
        fail(`dimensioni visive cambiate a pagina ${page + 1}`)
      }
      for (let i = 0; i < a.pixels.length; i++) {
        if (Math.abs(a.pixels[i] - b.pixels[i]) > 2) changed++
        samples++
      }
    }
    const ratio = samples === 0 ? 1 : changed / samples
    if (ratio > tolerance) fail(`rendering modificato: ${(ratio * 100).toFixed(4)}% pixel oltre tolleranza`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function normalized(value) {
  return value.normalize('NFKC').toLocaleLowerCase('it-IT').replace(/\s+/g, ' ').trim()
}

function assertText(output, status, originals, pseudonyms) {
  const text = normalized(command('pdftotext', ['-enc', 'UTF-8', output, '-']))
  for (const original of originals) {
    if (text.includes(normalized(original))) fail(`pdftotext contiene ancora un originale confermato`)
  }
  if (status === 'partial') {
    if (text.length > 0) fail('un output partial deve essere raster-only')
    return
  }
  for (const pseudonym of pseudonyms) {
    if (!text.includes(normalized(pseudonym))) fail(`pseudonimo non trovato da pdftotext: ${pseudonym}`)
  }
}

function streamHashes(path) {
  const doc = new mupdf.PDFDocument(new Uint8Array(readFileSync(path)))
  const hashes = new Set()
  try {
    for (let number = 1; number < doc.countObjects(); number++) {
      try {
        const object = doc.newIndirect(number).resolve()
        if (!object.isStream()) continue
        for (const bytes of [object.readRawStream(), object.readStream()]) {
          if (bytes.length >= 32) hashes.add(createHash('sha256').update(bytes).digest('hex'))
        }
      } catch { /* oggetti liberi o stream non decodificabili non sono confrontabili */ }
    }
    return hashes
  } finally { doc.destroy() }
}

function assertSanitized(source, output, originals) {
  const sourceHashes = streamHashes(source)
  const outputHashes = streamHashes(output)
  for (const hash of outputHashes) {
    if (sourceHashes.has(hash)) fail('uno stream originale e ancora presente byte-per-byte')
  }

  const doc = new mupdf.PDFDocument(new Uint8Array(readFileSync(output)))
  try {
    if (Object.keys(doc.getEmbeddedFiles()).length > 0) fail('sono presenti attachment')
    const trailer = doc.getTrailer()
    if (!trailer.get('Info').isNull()) {
      const info = normalized(trailer.get('Info').resolve().toString(false, true))
      for (const original of originals) if (info.includes(normalized(original))) fail('originale presente nei metadata Info')
    }
    const root = trailer.get('Root').resolve()
    if (!root.get('Metadata').isNull()) fail('e presente uno stream Metadata/XMP')
    if (!root.get('AF').isNull()) fail('e presente una relazione Associated Files')
    const names = root.get('Names')
    if (!names.isNull() && !names.get('EmbeddedFiles').isNull()) fail('e presente un name tree EmbeddedFiles')
  } finally { doc.destroy() }
}

export function verifySearchablePdf(options) {
  assertVisualIdentity(options.visualReference, options.output, options.tolerance)
  assertText(options.output, options.status, options.originals, options.pseudonyms)
  assertSanitized(options.source, options.output, options.originals)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifySearchablePdf(parseArgs(process.argv.slice(2)))
  process.stdout.write('searchable PDF gate: ok\n')
}
