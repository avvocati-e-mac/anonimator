/**
 * Logica pura per decidere se e come mostrare il banner di qualità OCR in
 * EntityReview. Estratta dal componente React perché il progetto non ha
 * un'infrastruttura di test per il renderer (vitest gira in ambiente 'node',
 * niente jsdom) — qui la logica resta testabile senza montare componenti.
 *
 * Non contiene MAI testo estratto dal documento: solo metriche numeriche e
 * frasi fisse, in linea con la regola "niente contenuto documentale nei log".
 */
import type { OcrLayerReport } from '@shared/types'

export type OcrBannerSeverity = 'warning' | 'critical'

export interface OcrBannerMessage {
  severity: OcrBannerSeverity
  title: string
  body: string
  /** false quando un nuovo OCR non risolverebbe: offrirlo sarebbe un rimedio finto. */
  showRedoButton: boolean
  /** Stima in minuti per il nuovo OCR, null quando non si offre. */
  estimatedMinutes: number | null
}

// L'OCR gira a ~2-4 s/pagina a 300 DPI; a questo si aggiunge il tempo per il
// riconoscimento entità. Usiamo un valore pessimista di proposito: una stima
// ottimista che poi delude è peggio di nessuna stima.
const PESSIMISTIC_SECONDS_PER_PAGE = 6

function estimateMinutes(pageCount: number): number {
  const pages = Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1
  return Math.max(1, Math.ceil((pages * PESSIMISTIC_SECONDS_PER_PAGE) / 60))
}

/** Formatta un valore in mm senza zeri decimali superflui (es. 4 invece di 4.0). */
function formatMm(mm: number): string {
  const rounded = Math.round(mm * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * @param ocrRedone true se in questa schermata l'utente ha gia' fatto rifare il
 *   riconoscimento del testo. Cambia i messaggi che altrimenti proporrebbero
 *   come rimedio proprio l'operazione appena eseguita: offrire di nuovo
 *   "Rifai OCR" a chi lo ha appena fatto e' un invito a girare in tondo, e
 *   fa sembrare rotto uno strumento che ha semplicemente fatto il possibile.
 */
export function selectOcrBannerMessage(
  report: OcrLayerReport | undefined,
  pageCount: number,
  ocrRedone = false
): OcrBannerMessage | null {
  if (!report || report.layerKind === 'digital') return null

  // Immagine troppo povera di dettaglio: nessun nuovo OCR può inventare
  // informazione che non è mai stata catturata dallo scanner. Sotto i ~150 DPI
  // nativi offrire "Rifai OCR" sarebbe un rimedio finto — il messaggio onesto
  // è che va tutto verificato a mano.
  if (report.imageQuality === 'poor') {
    const dpi = report.imageMetrics.nativeDpi
    const dpiPart = dpi !== null ? ` (circa ${Math.round(dpi)} DPI)` : ''
    return {
      severity: 'critical',
      title: 'Scansione di qualità troppo bassa',
      body:
        `La scansione ha una risoluzione troppo bassa${dpiPart} perché il riconoscimento del testo ` +
        'sia affidabile. Verificare a mano l\'elenco delle entità prima di procedere: alcuni dati ' +
        'personali potrebbero non essere stati rilevati, oppure essere stati individuati nel punto sbagliato.',
      showRedoButton: false,
      estimatedMinutes: null,
    }
  }

  // Il testo ricercabile e l'immagine non corrispondono: i riquadri di
  // anonimizzazione rischiano di finire nel punto sbagliato, lasciando
  // visibili dati che dovrebbero essere coperti. Qui un nuovo OCR, con un
  // layer di testo ricalcolato sull'immagine attuale, può risolvere.
  if (report.verdict === 'misaligned') {
    const marginalNote =
      report.imageQuality === 'marginal'
        ? ' La qualità della scansione è comunque modesta: anche dopo un nuovo OCR il risultato potrebbe restare imperfetto.'
        : ''
    return {
      severity: 'warning',
      title: 'Testo e immagine della scansione non allineati',
      body:
        `Il testo ricercabile di questa scansione non corrisponde all'immagine (scostamento di circa ` +
        `${formatMm(report.maxOffsetMm)} mm). I riquadri di anonimizzazione rischiano di finire nel punto ` +
        `sbagliato, lasciando visibili i dati che dovrebbero coprire.${marginalNote}`,
      showRedoButton: !ocrRedone,
      estimatedMinutes: ocrRedone ? null : estimateMinutes(pageCount),
    }
  }

  // Aumentare il DPI di rendering non può ricreare dettaglio che la scansione
  // non contiene. Questo avviso viene dopo il disallineamento, perché in quel
  // caso rifare l'OCR può ancora correggere la geometria del layer testuale.
  if (report.imageQuality === 'marginal'
    && report.imageQualityReasons.includes('low-native-dpi')) {
    const dpi = report.imageMetrics.nativeDpi
    const dpiPart = dpi !== null ? ` (circa ${Math.round(dpi)} DPI)` : ''
    return {
      severity: 'warning',
      title: 'Scansione a bassa risoluzione',
      body:
        `La scansione ha una risoluzione modesta${dpiPart}. Il riconoscimento può perdere caratteri ` +
        'piccoli o sbiaditi: verificare attentamente l’elenco delle entità. Un nuovo OCR a DPI più ' +
        'alti non può recuperare dettagli assenti nell’immagine originale.',
      showRedoButton: false,
      estimatedMinutes: null,
    }
  }

  if (report.textQuality === 'poor') {
    if (ocrRedone) {
      return {
        severity: 'critical',
        title: 'Testo illeggibile anche dopo il nuovo riconoscimento',
        body:
          'Anche ripetendo il riconoscimento, il testo di questa scansione resta in gran parte illeggibile: ' +
          'molti dati personali possono non essere stati rilevati. Rifarlo un\'altra volta darebbe lo stesso ' +
          'risultato. Verificare a mano l\'elenco delle entità, oppure procurarsi una scansione migliore ' +
          'dello stesso documento.',
        showRedoButton: false,
        estimatedMinutes: null,
      }
    }
    return {
      severity: 'warning',
      title: 'Testo della scansione poco leggibile',
      body:
        'Il testo ricercabile di questa scansione risulta in gran parte illeggibile: molti dati personali ' +
        'potrebbero non essere stati rilevati. Si consiglia di rifare il riconoscimento del testo prima di ' +
        'procedere con l\'anonimizzazione.',
      showRedoButton: true,
      estimatedMinutes: estimateMinutes(pageCount),
    }
  }

  if (report.textQuality === 'suspect') {
    if (ocrRedone) {
      return {
        severity: 'warning',
        title: 'Testo da verificare anche dopo il nuovo riconoscimento',
        body:
          'Il riconoscimento è stato rifatto, ma il testo presenta ancora alcune irregolarità: è possibile ' +
          'che qualche dato personale non sia stato riconosciuto correttamente. Conviene scorrere l\'elenco ' +
          'delle entità prima di procedere.',
        showRedoButton: false,
        estimatedMinutes: null,
      }
    }
    return {
      severity: 'warning',
      title: 'Testo della scansione da verificare',
      body:
        'Il testo ricercabile di questa scansione presenta alcune irregolarità: è possibile che qualche dato ' +
        'personale non sia stato riconosciuto correttamente. Un nuovo riconoscimento del testo potrebbe migliorare il risultato.',
      showRedoButton: true,
      estimatedMinutes: estimateMinutes(pageCount),
    }
  }

  // verdict === 'inconclusive' con tutto il resto a posto, oppure tutto buono:
  // non mostriamo nulla di proposito. L'incertezza sul verdetto è già gestita
  // altrove scegliendo il percorso di output più prudente — uno strumento che
  // grida al lupo ogni volta che non è sicuro al 100% diventa uno strumento
  // che gli utenti imparano a ignorare. Non "correggere" aggiungendo qui un
  // banner per 'inconclusive': è una scelta deliberata, non una dimenticanza.
  return null
}
