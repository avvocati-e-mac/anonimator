/**
 * Script di test manuale sui PDF reali.
 * Eseguire con: node tests/testRealPdfs.mjs
 *
 * Testa: parsePdf (estrazione testo), rilevamento isScanned,
 * e applica le regex NER sui testi estratti.
 */

import { readdir } from 'fs/promises'
import { join, basename } from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))

const PDF_DIR = join(__dirname, '..', 'PDF test')

// ── Regex italiane (copiate da nerService.ts) ────────────────────────────────
const PATTERNS = {
  CODICE_FISCALE: /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi,
  PARTITA_IVA:   /\b(?:P\.?\s?IVA\s*:?\s*)?([0-9]{11})\b/gi,
  IBAN:          /\bIT[0-9]{2}[A-Z][0-9]{22}\b/gi,
  EMAIL:         /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi,
  TELEFONO:      /\b(?:\+39[\s\-]?)?(?:0[0-9]{1,3}[\s\-]?[0-9]{5,8}|3[0-9]{2}[\s\-]?[0-9]{6,7})\b/g,
}

function matchAll(pattern, text) {
  pattern.lastIndex = 0
  const results = []
  for (const m of text.matchAll(pattern)) {
    const val = (m[1] ?? m[0]).trim()
    if (!results.includes(val)) results.push(val)
  }
  return results
}

// ── Setup pdfjs ──────────────────────────────────────────────────────────────
async function setupPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerPath = new URL(
    '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url
  ).href
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath
  return pdfjs
}

// ── Estrazione testo da PDF ───────────────────────────────────────────────────
async function extractPdfText(pdfjs, filePath) {
  const loadingTask = pdfjs.getDocument({ url: filePath, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true })
  const doc = await loadingTask.promise
  const pageCount = doc.numPages
  const pageTexts = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map(item => ('str' in item ? (item.hasEOL ? item.str + '\n' : item.str) : ''))
      .join('')
    pageTexts.push(pageText)
  }

  const text = pageTexts.join('\n\n')
  const avgCharsPerPage = text.length / pageCount
  const isScanned = avgCharsPerPage < 80

  return { text, pageCount, avgCharsPerPage: Math.round(avgCharsPerPage), isScanned }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const pdfjs = await setupPdfjs()
const files = (await readdir(PDF_DIR)).filter(f => f.endsWith('.pdf')).sort()

console.log(`\n${'═'.repeat(70)}`)
console.log(`TEST SUI PDF REALI — ${files.length} file`)
console.log(`${'═'.repeat(70)}\n`)

let totalEntities = 0
let scannedCount = 0

for (const file of files) {
  const filePath = join(PDF_DIR, file)
  const name = basename(file)
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`FILE: ${name}`)
  console.log(`${'─'.repeat(70)}`)

  try {
    const { text, pageCount, avgCharsPerPage, isScanned } = await extractPdfText(pdfjs, filePath)

    console.log(`Pagine:          ${pageCount}`)
    console.log(`Caratteri totali: ${text.length.toLocaleString('it-IT')}`)
    console.log(`Chars/pagina:    ${avgCharsPerPage}`)
    console.log(`Tipo:            ${isScanned ? '⚠️  SCANSIONATO (richiede OCR)' : '✓  NATIVO (testo digitale)'}`)

    if (isScanned) {
      scannedCount++
      console.log('\n  → Contenuto non analizzabile senza OCR (ita.traineddata mancante)')
      continue
    }

    // Mostra un estratto del testo (prime 3 righe non vuote)
    const preview = text.split('\n').filter(l => l.trim().length > 5).slice(0, 3).join(' | ')
    console.log(`\nEstratto:  "${preview.substring(0, 120)}…"`)

    // Applica regex
    let fileEntities = 0
    console.log('\nEntità strutturate trovate:')
    for (const [type, pattern] of Object.entries(PATTERNS)) {
      const matches = matchAll(pattern, text)
      if (matches.length > 0) {
        console.log(`  ${type.padEnd(16)} → ${matches.slice(0, 5).join(', ')}${matches.length > 5 ? ` (+${matches.length - 5} altri)` : ''}`)
        fileEntities += matches.length
      }
    }
    if (fileEntities === 0) {
      console.log('  (nessuna entità strutturata rilevata con regex)')
    }
    totalEntities += fileEntities

  } catch (err) {
    console.log(`ERRORE: ${err.message}`)
  }
}

console.log(`\n${'═'.repeat(70)}`)
console.log(`RIEPILOGO`)
console.log(`${'═'.repeat(70)}`)
console.log(`PDF analizzati:        ${files.length}`)
console.log(`PDF nativi (testo):    ${files.length - scannedCount}`)
console.log(`PDF scansionati (OCR): ${scannedCount}`)
console.log(`Entità totali trovate: ${totalEntities}`)
console.log(`${'═'.repeat(70)}\n`)
