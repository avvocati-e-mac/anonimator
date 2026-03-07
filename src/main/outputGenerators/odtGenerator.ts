import fs from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'
import type { DetectedEntity } from '@shared/types'

/**
 * Anonimizza un ODT sostituendo il testo in content.xml.
 *
 * Approccio paragraph-by-paragraph: per ogni <text:p> e <text:h> raccoglie il
 * testo visibile (nodi diretti + <text:span>), trova le entità nel testo
 * concatenato, poi riscrive in ordine inverso. Gestisce il run-split di
 * LibreOffice (testo spezzato in <text:span> multipli).
 *
 * Salva come [nome]_anonimizzato.odt.
 */
export async function generateOdt(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const buffer = await fs.readFile(filePath)
  const zip = new AdmZip(buffer)

  const entry = zip.getEntry('content.xml')
  if (!entry) throw new Error('Struttura ODT non valida: content.xml mancante.')

  const xmlContent = entry.getData().toString('utf-8')
  const { text: anonymizedXml, count } = processParagraphs(xmlContent, entities)

  zip.updateFile('content.xml', Buffer.from(anonymizedXml, 'utf-8'))

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.odt`)

  await fs.writeFile(outputPath, zip.toBuffer())
  return { outputPath, entitiesReplaced: count }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeQuotes(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

interface TextSegment {
  start: number
  end: number
  tagStart: number
  tagEnd: number
  text: string
  /**
   * true = il testo è dentro un <text:span>...</text:span>
   * false = è un nodo testo diretto del paragrafo (tra tag diversi)
   */
  isSpan: boolean
  /** Se isSpan, il contenuto completo dell'elemento span (per trovarlo nell'XML) */
  spanContent?: string
}

interface Replacement {
  start: number
  end: number
  pseudonym: string
}

/**
 * Estrae tutti i segmenti di testo visibile da un paragrafo ODT.
 *
 * ODT ha due forme di testo in un paragrafo:
 *   1. Testo diretto: <text:p>TESTO<text:span>...</text:span>TESTO</text:p>
 *   2. Dentro span: <text:span text:style-name="...">TESTO</text:span>
 *
 * Usiamo una regex che cattura entrambe le forme in ordine di apparizione.
 */
function extractTextSegments(paraXml: string): TextSegment[] {
  const segments: TextSegment[] = []
  let concatPos = 0

  // Regex che matcha sia testo diretto tra tag che contenuto di text:span
  // Cattura il testo tra la fine di un tag e l'inizio del successivo (testo diretto)
  // oppure il contenuto di <text:span ...>TESTO</text:span>
  const tokenRegex = /(<text:span(?:\s[^>]*)?>([^<]*)<\/text:span>)|>([^<]+)</g
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(paraXml)) !== null) {
    if (match[1] !== undefined) {
      // Caso 1: <text:span ...>TESTO</text:span>
      const rawText = match[2]
      const decodedText = unescapeXml(rawText)
      if (decodedText.length > 0) {
        segments.push({
          start: concatPos,
          end: concatPos + decodedText.length,
          tagStart: match.index,
          tagEnd: match.index + match[0].length,
          text: decodedText,
          isSpan: true,
          spanContent: rawText,
        })
        concatPos += decodedText.length
      }
    } else if (match[3] !== undefined) {
      // Caso 2: testo diretto >TESTO< (il > e < sono i delimitatori dei tag circostanti)
      const rawText = match[3]
      const decodedText = unescapeXml(rawText)
      if (decodedText.trim().length > 0) {
        // tagStart punta al carattere dopo il >
        const textStart = match.index + 1
        segments.push({
          start: concatPos,
          end: concatPos + decodedText.length,
          tagStart: textStart,
          tagEnd: textStart + rawText.length,
          text: decodedText,
          isSpan: false,
        })
        concatPos += decodedText.length
      }
    }
  }

  return segments
}

function findReplacements(paraText: string, entities: DetectedEntity[]): Replacement[] {
  const replacements: Replacement[] = []
  const normalizedParaText = normalizeQuotes(paraText)

  for (const entity of entities) {
    if (!entity.confirmed) continue
    const normalizedOriginal = normalizeQuotes(entity.originalText)
    const escaped = normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    let m: RegExpExecArray | null

    while ((m = regex.exec(normalizedParaText)) !== null) {
      const start = m.index
      const end = start + m[0].length
      const overlaps = replacements.some((r) => start < r.end && end > r.start)
      if (!overlaps) {
        replacements.push({ start, end, pseudonym: entity.pseudonym })
      }
    }
  }

  return replacements.sort((a, b) => b.start - a.start)
}

/**
 * Applica le sostituzioni a un singolo paragrafo ODT.
 */
function processSingleParagraph(paraXml: string, entities: DetectedEntity[]): { xml: string; count: number } {
  const segments = extractTextSegments(paraXml)
  if (segments.length === 0) return { xml: paraXml, count: 0 }

  const paraText = segments.map((s) => s.text).join('')
  const replacements = findReplacements(paraText, entities)
  if (replacements.length === 0) return { xml: paraXml, count: 0 }

  let result = paraXml
  let count = 0

  for (const rep of replacements) {
    const involved = segments.filter((s) => s.start < rep.end && s.end > rep.start)
    if (involved.length === 0) continue

    const toModify = [...involved].reverse()
    let xmlCursor = result

    for (let i = 0; i < toModify.length; i++) {
      const seg = toModify[i]
      const isFirst = i === toModify.length - 1

      if (seg.isSpan) {
        // Sostituisci il contenuto dello span
        const escapedContent = (seg.spanContent ?? seg.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const spanRegex = new RegExp(`(<text:span(?:\\s[^>]*)?>)${escapedContent}(<\\/text:span>)`, 'g')
        const allSameSpans = segments.filter((s) => s.isSpan && s.text === seg.text)
        const occIdx = allSameSpans.indexOf(seg)
        let idx = 0
        xmlCursor = xmlCursor.replace(spanRegex, (full, open, close) => {
          if (idx === occIdx) {
            idx++
            return isFirst ? `${open}${escapeXml(rep.pseudonym)}${close}` : `${open}${close}`
          }
          idx++
          return full
        })
      } else {
        // Sostituisci il testo diretto: usa offset nel xml
        // Per il testo diretto usiamo replace string-based con occorrenza
        const escapedText = escapeXml(seg.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const directRegex = new RegExp(escapedText, 'g')
        const allSameDirect = segments.filter((s) => !s.isSpan && s.text === seg.text)
        const occIdx = allSameDirect.indexOf(seg)
        let idx = 0
        xmlCursor = xmlCursor.replace(directRegex, (full) => {
          if (idx === occIdx) {
            idx++
            return isFirst ? escapeXml(rep.pseudonym) : ''
          }
          idx++
          return full
        })
      }
    }

    result = xmlCursor
    count++
  }

  return { xml: result, count }
}

/**
 * Processa tutti i paragrafi <text:p> e <text:h> nel documento XML ODT.
 */
function processParagraphs(
  xml: string,
  entities: DetectedEntity[]
): { text: string; count: number } {
  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  let totalCount = 0
  const result = xml.replace(/<text:[ph][ >][\s\S]*?<\/text:[ph]>/g, (paraXml) => {
    const { xml: processed, count } = processSingleParagraph(paraXml, confirmed)
    totalCount += count
    return processed
  })

  return { text: result, count: totalCount }
}
