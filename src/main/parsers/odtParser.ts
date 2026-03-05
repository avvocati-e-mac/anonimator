import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'
import type { ParseResult } from './index'
import log from 'electron-log'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['text:p', 'text:span', 'text:h', 'text:list', 'text:list-item', 'table:table-row', 'table:table-cell'].includes(name)
})

/**
 * Estrae il testo da un file .odt.
 *
 * Struttura ODT rilevante (content.xml):
 *   office:document-content
 *     office:body
 *       office:text
 *         text:p  (paragrafo)
 *           text:span  (testo con stessa formattazione)
 *           #text  (testo diretto nel paragrafo)
 *         text:h  (titolo, trattato come paragrafo)
 */
export async function parseOdt(filePath: string): Promise<ParseResult> {
  const warnings: string[] = []

  let zip: AdmZip
  try {
    zip = new AdmZip(filePath)
  } catch {
    throw new Error('Il file ODT è corrotto o protetto da password. Prova a riaprirlo e salvarlo nuovamente.')
  }

  const entry = zip.getEntry('content.xml')
  if (!entry) {
    throw new Error('Struttura ODT non valida: manca content.xml.')
  }

  const xmlContent = entry.getData().toString('utf-8')

  let parsed: ReturnType<typeof xmlParser.parse>
  try {
    parsed = xmlParser.parse(xmlContent)
  } catch {
    throw new Error('Impossibile leggere il contenuto XML del documento ODT.')
  }

  // Naviga fino a office:text
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeText = parsed?.['office:document-content']?.['office:body']?.['office:text'] as any
  if (!officeText) {
    warnings.push('Documento ODT vuoto o struttura non riconosciuta.')
    return { text: '', pageCount: 0, warnings }
  }

  const paragraphs: string[] = []
  extractOdtParagraphs(officeText, paragraphs)

  const text = paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join('\n')

  // ODT non ha un conteggio pagine esplicito nell'XML di contenuto
  const pageCount = Math.max(1, Math.ceil(text.length / 3000))

  log.info('ODT parsed', { chars: text.length, paragraphs: paragraphs.length, pageCount })

  return { text, pageCount, warnings }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOdtParagraphs(node: any, out: string[]): void {
  if (!node || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const item of node) extractOdtParagraphs(item, out)
    return
  }

  // Paragrafo o titolo: estrai tutto il testo che contiene
  if ('text:p' in node) {
    const ps = Array.isArray(node['text:p']) ? node['text:p'] : [node['text:p']]
    for (const p of ps) out.push(extractOdtTextFromNode(p))
  }
  if ('text:h' in node) {
    const hs = Array.isArray(node['text:h']) ? node['text:h'] : [node['text:h']]
    for (const h of hs) out.push(extractOdtTextFromNode(h))
  }

  // Scendi ricorsivamente per trovare paragrafi annidati (es. in tabelle)
  for (const key of Object.keys(node)) {
    if (key.startsWith('table:') || key.startsWith('office:') || key.startsWith('draw:')) {
      extractOdtParagraphs(node[key], out)
    }
  }
}

// Estrae tutto il testo da un nodo paragrafo ODT (ricorsivo per gli span annidati)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOdtTextFromNode(node: any): string {
  if (!node || typeof node !== 'object') return typeof node === 'string' ? node : ''

  const parts: string[] = []

  // Testo diretto nel nodo
  if ('#text' in node) {
    parts.push(String(node['#text']))
  }

  // Testo dentro text:span (formattazione inline)
  if ('text:span' in node) {
    const spans = Array.isArray(node['text:span']) ? node['text:span'] : [node['text:span']]
    for (const span of spans) {
      parts.push(extractOdtTextFromNode(span))
    }
  }

  // Interruzione di riga text:line-break → spazio
  if ('text:line-break' in node) {
    parts.push(' ')
  }

  // Tabulazione text:tab → spazio
  if ('text:tab' in node) {
    parts.push(' ')
  }

  return parts.join('')
}
