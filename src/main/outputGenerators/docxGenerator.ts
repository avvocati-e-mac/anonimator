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
 *
 * Strategia corretta (redistribuzione):
 * 1. Estrae i segmenti <w:t> con le loro posizioni nel testo concatenato
 * 2. Calcola tutte le sostituzioni sul testo concatenato
 * 3. Applica le sostituzioni al testo concatenato (da destra a sinistra per
 *    preservare gli offset), producendo un nuovo testo concatenato
 * 4. Ridistribuisce il nuovo testo concatenato nei <w:t> originali:
 *    - Il primo <w:t> coinvolto riceve tutta la porzione di testo che lo riguarda
 *    - I <w:t> successivi coinvolti vengono svuotati
 *    - I <w:t> non coinvolti rimangono invariati
 *
 * Questo approccio gestisce correttamente N entità in un singolo <w:t> perché
 * lavora sempre sul testo originale, non su un XML già parzialmente modificato.
 */
function processSingleParagraph(paraXml: string, entities: DetectedEntity[]): { xml: string; count: number } {
  const segments = extractTextSegments(paraXml)
  if (segments.length === 0) return { xml: paraXml, count: 0 }

  const paraText = segments.map((s) => s.text).join('')
  const replacements = findReplacements(paraText, entities)
  if (replacements.length === 0) return { xml: paraXml, count: 0 }

  // `replacements` è già ordinato desc da findReplacements.
  // Strategia: applica tutte le patch al testo concatenato del paragrafo (da destra a
  // sinistra, per preservare gli offset). Poi ridistribuisce il testo risultante nei
  // <w:t> usando la struttura originale dei segmenti come schema di "contenitori".
  //
  // Approccio contenitori:
  //   Ogni segmento definisce un intervallo [start, end) nel testo originale.
  //   Dopo le sostituzioni, il testo del paragrafo cambia lunghezza. Teniamo traccia
  //   degli spostamenti con una mappa offset[], poi estraiamo la porzione di testo
  //   nuovo che "appartiene" a ciascun segmento in base al contenitore originale.
  //
  //   Per semplificare, usiamo un approccio diverso: per ogni segmento, raccogliamo
  //   tutte le patch che lo toccano e le applichiamo localmente sul suo testo,
  //   trattando le patch multi-segmento in modo speciale.

  // Ordina le patch per posizione crescente
  const patchesAsc = [...replacements]
    .sort((a, b) => a.start - b.start)
    .map((r) => ({ start: r.start, end: r.end, replacement: r.pseudonym }))

  // Rappresentiamo il paragrafo come array di token: testo-letterale o sostituzione.
  // I token di sostituzione sono INDIVISIBILI (il pseudonimo va tutto nel primo segmento
  // coinvolto); i token di testo letterale sono DIVISIBILI (possono essere spezzati
  // tra più segmenti).
  interface Token { origStart: number; origEnd: number; text: string; isSubstitution: boolean }
  const tokens: Token[] = []
  let cursor = 0
  for (const patch of patchesAsc) {
    if (cursor < patch.start) {
      tokens.push({ origStart: cursor, origEnd: patch.start, text: paraText.slice(cursor, patch.start), isSubstitution: false })
    }
    tokens.push({ origStart: patch.start, origEnd: patch.end, text: patch.replacement, isSubstitution: true })
    cursor = patch.end
  }
  if (cursor < paraText.length) {
    tokens.push({ origStart: cursor, origEnd: paraText.length, text: paraText.slice(cursor), isSubstitution: false })
  }

  // Per ogni segmento, raccogli i token che si sovrappongono con il range [seg.start, seg.end).
  // Regola per token di sostituzione (indivisibili):
  //   - Va assegnato TUTTO al primo segmento che lo tocca.
  //   - I segmenti successivi che ricadono nel range originale della patch ricevono ''.
  // Regola per token di testo (divisibili):
  //   - Prendi solo la porzione che rientra nel range del segmento.

  // Prima passiamo a tracciare a quale segmento è già stato assegnato ogni token di sostituzione
  const substitutionAssignedTo = new Map<Token, number>() // token → indice segmento primo assegnatario
  for (const tok of tokens) {
    if (!tok.isSubstitution) continue
    const firstSegIdx = segments.findIndex((s) => s.start < tok.origEnd && s.end > tok.origStart)
    if (firstSegIdx !== -1) substitutionAssignedTo.set(tok, firstSegIdx)
  }

  const newSegmentTexts: string[] = segments.map((seg, segIdx) => {
    let segText = ''
    for (const tok of tokens) {
      // Nessuna sovrapposizione tra il range originale del token e il segmento
      if (tok.origEnd <= seg.start || tok.origStart >= seg.end) continue

      if (tok.isSubstitution) {
        // Token di sostituzione: assegna il testo solo al primo segmento coinvolto
        if (substitutionAssignedTo.get(tok) === segIdx) {
          segText += tok.text
        }
        // Gli altri segmenti coinvolti ricevono '' (niente da aggiungere)
      } else {
        // Token di testo letterale: divisibile, prendi la porzione che appartiene al segmento
        const relStart = Math.max(0, seg.start - tok.origStart)
        const relEnd = Math.min(tok.text.length, seg.end - tok.origStart)
        segText += tok.text.slice(relStart, relEnd)
      }
    }
    return segText
  })

  // Step 3: Ricostruisce l'XML sostituendo il contenuto di ogni <w:t> dall'ultimo al primo
  // (lavorare in ordine inverso preserva gli indici tagStart/tagEnd)
  let xmlResult = paraXml
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    const newText = newSegmentTexts[i]
    if (newText === seg.text) continue // invariato: salta

    const before = xmlResult.slice(0, seg.tagStart)
    const after = xmlResult.slice(seg.tagEnd)

    // Ricostruisce il tag preservando gli attributi originali (es. xml:space="preserve")
    const originalTag = xmlResult.slice(seg.tagStart, seg.tagEnd)
    const openTagMatch = /^(<w:t(?:\s[^>]*)?>)/.exec(originalTag)
    const openTag = openTagMatch ? openTagMatch[1] : '<w:t>'

    // Aggiunge xml:space="preserve" se il nuovo testo ha spazi iniziali/finali
    const needsPreserve = (newText.startsWith(' ') || newText.endsWith(' ')) && !openTag.includes('xml:space')
    const finalOpenTag = needsPreserve
      ? openTag.replace(/^<w:t/, '<w:t xml:space="preserve"')
      : openTag

    xmlResult = before + finalOpenTag + escapeXml(newText) + '</w:t>' + after
  }

  return { xml: xmlResult, count: patchesAsc.length }
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
