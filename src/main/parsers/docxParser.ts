import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'
import type { ParseResult } from './index'
import log from 'electron-log'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['w:p', 'w:r', 'w:t', 'w:body', 'w:tbl', 'w:tr', 'w:tc'].includes(name)
})

/**
 * Estrae il testo da un file .docx.
 *
 * Struttura DOCX rilevante:
 *   word/document.xml
 *     w:body
 *       w:p  (paragrafo)
 *         w:r  (run = segmento di testo con stessa formattazione)
 *           w:t  (testo effettivo)
 *
 * Ogni paragrafo diventa una riga; i run dello stesso paragrafo vengono concatenati.
 */
export async function parseDocx(filePath: string): Promise<ParseResult> {
  const warnings: string[] = []

  let zip: AdmZip
  try {
    zip = new AdmZip(filePath)
  } catch {
    throw new Error('Il file DOCX è corrotto o protetto da password. Prova a riaprirlo e salvarlo nuovamente.')
  }

  const entry = zip.getEntry('word/document.xml')
  if (!entry) {
    throw new Error('Struttura DOCX non valida: manca word/document.xml.')
  }

  const xmlContent = entry.getData().toString('utf-8')

  let parsed: ReturnType<typeof xmlParser.parse>
  try {
    parsed = xmlParser.parse(xmlContent)
  } catch {
    throw new Error('Impossibile leggere il contenuto XML del documento.')
  }

  // Naviga nella struttura XML fino ai paragrafi
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = parsed?.['w:document']?.['w:body'] as any
  if (!body) {
    warnings.push('Documento DOCX vuoto o struttura non riconosciuta.')
    return { text: '', pageCount: 0, warnings }
  }

  const paragraphs: string[] = []

  // Processa paragrafi w:p (inclusi quelli nelle tabelle)
  extractParagraphsFromNode(body, paragraphs)

  const text = paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join('\n')

  // Conta le interruzioni di pagina esplicite (w:lastRenderedPageBreak o w:pageBreak)
  const pageBreaks = (xmlContent.match(/w:type="page"/g) ?? []).length
  const pageCount = Math.max(1, pageBreaks + 1)

  log.info('DOCX parsed', { chars: text.length, paragraphs: paragraphs.length, pageCount })

  return { text, pageCount, warnings }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractParagraphsFromNode(node: any, out: string[]): void {
  if (!node || typeof node !== 'object') return

  // Se il nodo è un array, itera
  if (Array.isArray(node)) {
    for (const item of node) extractParagraphsFromNode(item, out)
    return
  }

  // Paragrafo trovato: estrai il testo dai run
  if ('w:r' in node || 'w:t' in node) {
    out.push(extractTextFromParagraph(node))
    return
  }

  // Altrimenti scendi ricorsivamente (gestisce tabelle w:tbl, w:tr, w:tc, ecc.)
  for (const key of Object.keys(node)) {
    if (key.startsWith('w:')) {
      extractParagraphsFromNode(node[key], out)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextFromParagraph(para: any): string {
  const runs: string[] = []

  const rawRuns = para['w:r']
  if (!rawRuns) return ''

  const runList = Array.isArray(rawRuns) ? rawRuns : [rawRuns]
  for (const run of runList) {
    if (!run) continue
    const t = run['w:t']
    if (t === undefined || t === null) continue
    // w:t può essere: stringa, oggetto {#text, @_xml:space}, oppure array di questi
    const tList = Array.isArray(t) ? t : [t]
    for (const item of tList) {
      if (typeof item === 'object' && item !== null) {
        runs.push(String(item['#text'] ?? ''))
      } else {
        runs.push(String(item))
      }
    }
  }

  return runs.join('')
}
