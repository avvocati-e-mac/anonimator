#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mupdf, { emptyStore } from 'mupdf'

if (typeof global.gc !== 'function') {
  throw new Error('RSS gate: avviare con node --expose-gc scripts/check-pdf-rss.mjs')
}

const corpus = process.argv.length > 2 ? process.argv.slice(2) : [
  'tests/corpus-ocr/negativi/neg-13-misto.pdf',
  'tests/corpus-ocr/geometrici/geo-11-rotate-90.pdf',
  'tests/corpus-ocr/geometrici/geo-17-userunit.pdf',
  'tests/corpus-ocr/immagine/img-11-smask.pdf',
  'tests/corpus-ocr/immagine/img-14-g4-grande.pdf'
]

function exercisePdf(path) {
  const doc = new mupdf.PDFDocument(new Uint8Array(readFileSync(path)))
  try {
    for (let index = 0; index < doc.countPages(); index++) {
      const page = doc.loadPage(index)
      try {
        const text = page.toStructuredText('preserve-images')
        try { text.asJSON(1) } finally { text.destroy() }
        const pixmap = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, true)
        try { pixmap.getPixels().byteLength } finally { pixmap.destroy() }
      } finally { page.destroy() }
    }
  } finally { doc.destroy() }
}

function pass() {
  for (const relative of corpus) exercisePdf(join(process.cwd(), relative))
  // La cache globale MuPDF non appartiene a un Document e va svuotata
  // esplicitamente prima di misurare gli oggetti ancora raggiungibili.
  emptyStore()
  global.gc()
  return process.memoryUsage().rss
}

// Le prime passate possono far crescere la heap WASM fino al suo high-water mark.
pass()
pass()
const samples = Array.from({ length: 8 }, pass)
const mib = 1024 * 1024
const growth = samples.at(-1) - samples[0]
let risingSteps = 0
for (let i = 1; i < samples.length; i++) if (samples[i] > samples[i - 1] + mib) risingSteps++

// Fallisce solo davanti a una crescita insieme grande e quasi monotona: picchi e
// plateau dell'allocator non sono leak. 32 MiB e' maggiore di un singolo raster
// del corpus ma abbastanza basso da intercettare oggetti MuPDF non distrutti.
if (growth > 32 * mib && risingSteps >= samples.length - 2) {
  throw new Error(`RSS gate: crescita monotona significativa (${(growth / mib).toFixed(1)} MiB)`)
}

process.stdout.write(`RSS gate: ok (${samples.map((rss) => (rss / mib).toFixed(1)).join(', ')} MiB)\n`)
