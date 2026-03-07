import fs from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'
import type { DetectedEntity } from '@shared/types'

/**
 * Anonimizza un DOCX sostituendo il testo nell'XML interno (word/document.xml).
 *
 * Approccio paragraph-by-paragraph: per ogni <w:p> raccoglie il testo di tutti
 * i <w:t>, trova le entità nel testo concatenato, poi riscrive i <w:t> coinvolti
 * in ordine inverso. Questo gestisce correttamente il run-split (quando "Mario Rossi"
 * è spezzato in <w:t>Mario</w:t>...<w:t> Rossi</w:t> da Word).
 *
 * Salva come [nome]_anonimizzato.docx.
 */
export async function generateDocx(
  filePath: string,
  entities: DetectedEntity[]
): Promise<{ outputPath: string; entitiesReplaced: number }> {
  const buffer = await fs.readFile(filePath)
  const zip = new AdmZip(buffer)

  const entry = zip.getEntry('word/document.xml')
  if (!entry) throw new Error('Struttura DOCX non valida: word/document.xml mancante.')

  const xmlContent = entry.getData().toString('utf-8')
  const { text: anonymizedXml, count } = processParagraphs(xmlContent, entities)

  zip.updateFile('word/document.xml', Buffer.from(anonymizedXml, 'utf-8'))

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outputPath = path.join(dir, `${base}_anonimizzato.docx`)

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
  /** posizione di inizio del testo nel testo concatenato del paragrafo */
  start: number
  /** posizione di fine (esclusiva) */
  end: number
  /** indice del tag <w:t>...</w:t> nel paraXml */
  tagStart: number
  /** indice di fine del tag (esclusivo) nel paraXml */
  tagEnd: number
  /** il testo decodificato (unescaped) */
  text: string
}

interface Replacement {
  start: number // nel testo concatenato
  end: number
  pseudonym: string
}

/**
 * Trova tutti i segmenti <w:t...>TESTO</w:t> nel XML del paragrafo.
 * Restituisce i loro offset nel testo concatenato e la posizione nel XML.
 */
function extractTextSegments(paraXml: string): TextSegment[] {
  const segments: TextSegment[] = []
  // Matcha <w:t> con eventuali attributi (es. xml:space="preserve")
  const wtRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
  let concatPos = 0
  let match: RegExpExecArray | null

  while ((match = wtRegex.exec(paraXml)) !== null) {
    const rawText = match[1]
    const decodedText = unescapeXml(rawText)
    segments.push({
      start: concatPos,
      end: concatPos + decodedText.length,
      tagStart: match.index,
      tagEnd: match.index + match[0].length,
      text: decodedText,
    })
    concatPos += decodedText.length
  }

  return segments
}

/**
 * Trova tutte le sostituzioni da fare nel testo concatenato del paragrafo.
 * Le entità più lunghe hanno priorità (già ordinate per lunghezza decrescente).
 */
function findReplacements(paraText: string, entities: DetectedEntity[]): Replacement[] {
  const replacements: Replacement[] = []
  const normalizedParaText = normalizeQuotes(paraText)

  for (const entity of entities) {
    if (!entity.confirmed) continue
    const normalizedOriginal = normalizeQuotes(entity.originalText)
    const escaped = normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    let match: RegExpExecArray | null

    while ((match = regex.exec(normalizedParaText)) !== null) {
      const start = match.index
      const end = start + match[0].length
      // Evita sovrapposizioni con sostituzioni già trovate
      const overlaps = replacements.some((r) => start < r.end && end > r.start)
      if (!overlaps) {
        replacements.push({ start, end, pseudonym: entity.pseudonym })
      }
    }
  }

  // Ordina per posizione decrescente (per applicare le sostituzioni dalla fine)
  return replacements.sort((a, b) => b.start - a.start)
}

/**
 * Applica le sostituzioni a un singolo paragrafo DOCX.
 * Modifica i <w:t> coinvolti in ordine inverso per non invalidare gli offset.
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
    // Trova i segmenti coinvolti in questa sostituzione
    const involved = segments.filter((s) => s.start < rep.end && s.end > rep.start)
    if (involved.length === 0) continue

    // Applica in ordine inverso (dall'ultimo al primo) per non invalidare gli indici
    // Dobbiamo ricalcolare gli offset nel result corrente: usiamo un approccio
    // che trova i tag in ordine inverso
    const toModify = [...involved].reverse()

    let xmlCursor = result
    // Prima svuota tutti i tag coinvolti tranne il primo (che riceverà il pseudonimo)
    // Lavoriamo dall'ultimo al secondo perché gli indici cambiano
    for (let i = 0; i < toModify.length; i++) {
      const seg = toModify[i]
      const isFirst = i === toModify.length - 1 // il "primo" coinvolto è l'ultimo in ordine inverso

      // Ricostruiamo la regex per trovare questo specifico tag nel xml corrente
      // Usiamo il contenuto del testo come chiave di ricerca (può avere duplicati,
      // ma l'approccio inverso riduce i falsi positivi)
      const escapedText = seg.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const tagContent = escapeXml(seg.text)
      const escapedTagContent = tagContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      // Troviamo TUTTE le occorrenze di questo w:t nel xml e prendiamo quella
      // corrispondente alla posizione corretta. Usiamo un indice basato sull'ordine
      // di apparizione.
      const allSegmentsWithSameText = segments.filter((s) => s.text === seg.text)
      const occurrenceIndex = allSegmentsWithSameText.indexOf(seg)

      const wtSearchRegex = new RegExp(`(<w:t(?:\\s[^>]*)?>)${escapedTagContent}(<\\/w:t>)`, 'g')
      let matchIndex = 0
      let found = false
      xmlCursor = xmlCursor.replace(wtSearchRegex, (full, open, close) => {
        if (matchIndex === occurrenceIndex) {
          found = true
          matchIndex++
          if (isFirst) {
            return `${open}${escapeXml(rep.pseudonym)}${close}`
          } else {
            return `${open}${close}`
          }
        }
        matchIndex++
        return full
      })

      if (!found) {
        // Fallback: cerca per testo grezzo (senza XML escape) — testo già ASCII
        const escapedRaw = escapedText
        const rawRegex = new RegExp(`(<w:t(?:\\s[^>]*)?>)${escapedRaw}(<\\/w:t>)`, 'g')
        let rawIdx = 0
        xmlCursor = xmlCursor.replace(rawRegex, (full, open, close) => {
          if (rawIdx === occurrenceIndex) {
            rawIdx++
            if (isFirst) {
              return `${open}${escapeXml(rep.pseudonym)}${close}`
            } else {
              return `${open}${close}`
            }
          }
          rawIdx++
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
 * Processa tutti i paragrafi <w:p> nel documento XML.
 */
function processParagraphs(
  xml: string,
  entities: DetectedEntity[]
): { text: string; count: number } {
  const confirmed = entities
    .filter((e) => e.confirmed)
    .sort((a, b) => b.originalText.length - a.originalText.length)

  let totalCount = 0
  // Splitta su paragrafi preservando i delimitatori
  const result = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paraXml) => {
    const { xml: processed, count } = processSingleParagraph(paraXml, confirmed)
    totalCount += count
    return processed
  })

  return { text: result, count: totalCount }
}
