import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { analyzeOcrLayer } from '../src/main/services/ocrLayerCheck'
import type {
  ImageQualityVerdict,
  OcrLayerVerdict,
  PdfLayerKind,
  TextQualityVerdict
} from '../src/shared/types'

const CORPUS = join(__dirname, 'corpus-ocr')

interface Atteso {
  file: string
  kind: PdfLayerKind
  verdict: OcrLayerVerdict
  image?: ImageQualityVerdict
  text?: TextQualityVerdict
  nota?: string
}

/**
 * Catalogo di riferimento. I valori non sono stati scritti a priori: vengono
 * dalla taratura del Gate A e sono stati verificati uno per uno. Una modifica
 * al motore che sposti una di queste righe va capita, non accomodata.
 */

// ─── negativi: qui si misurano i FALSI POSITIVI. Zero tolleranza. ────────────
const NEGATIVI: Atteso[] = [
  { file: 'negativi/neg-01-digitale-nativo', kind: 'digital', verdict: 'inconclusive',
    nota: 'PDF digitale: il controllo non si applica' },
  { file: 'negativi/neg-02-allineato-flate', kind: 'scan-with-text', verdict: 'aligned', image: 'good', text: 'good' },
  { file: 'negativi/neg-03-allineato-jpeg', kind: 'scan-with-text', verdict: 'aligned', image: 'good' },
  { file: 'negativi/neg-05-slop-3pt', kind: 'scan-with-text', verdict: 'aligned',
    nota: '3pt di scarto restano dentro la tolleranza di redazione' },
  { file: 'negativi/neg-06-glyphless', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'negativi/neg-07-timbro', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'timbro e firma aggiungono inchiostro: prova del lift' },
  { file: 'negativi/neg-08-tabella-densa', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'i filetti di tabella non devono far crollare lineAgreement' },
  { file: 'negativi/neg-09-carta-grigia', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'fondo grigio: prova della soglia su modaPaper invece che Otsu' },
  { file: 'negativi/neg-10-due-colonne', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'lineAgreement deve guardare solo la finestra x della riga' },
  { file: 'negativi/neg-11-quasi-vuota', kind: 'scan-with-text', verdict: 'inconclusive',
    nota: 'pagina quasi vuota: astensione, non accusa' },
  { file: 'negativi/neg-12-pagina-scura', kind: 'scan-with-text', verdict: 'inconclusive' },
  { file: 'negativi/neg-13-misto', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'pag.1 nativa, pag.2 scansione allineata' },
  { file: 'negativi/neg-14-margini-bianchi', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'la pagina di coda è rada: fitScaleY deve astenersi, non inventare una scala' }
]

// ─── geometrici: devono essere TUTTI rilevati. ───────────────────────────────
const GEOMETRICI: Atteso[] = [
  'geo-01-dy-6pt', 'geo-02-dy-20pt', 'geo-03-dx-15pt', 'geo-04-diagonale',
  'geo-05-una-riga', 'geo-06-due-righe', 'geo-07-scala-200-300', 'geo-08-scala-1pct',
  'geo-09-cropbox', 'geo-10-mediabox-origine', 'geo-11-rotate-90', 'geo-12-rotate-180',
  'geo-13-capovolto', 'geo-14-specchiato', 'geo-15-deskew', 'geo-16-obliqua',
  'geo-17-userunit', 'geo-18-pagina-sfasata', 'geo-19-blocco-unico', 'geo-20-solo-prima-pagina'
].map((n) => ({ file: `geometrici/${n}`, kind: 'scan-with-text' as const, verdict: 'misaligned' as const }))

// ─── qualità dell'immagine sorgente ──────────────────────────────────────────
const IMMAGINE: Atteso[] = [
  { file: 'immagine/img-01-dpi-300', kind: 'scan-with-text', verdict: 'aligned', image: 'good' },
  { file: 'immagine/img-02-dpi-150', kind: 'scan-with-text', verdict: 'aligned', image: 'marginal',
    nota: 'a 150 DPI la x sta sui 10px: soglia documentata di Tesseract' },
  { file: 'immagine/img-03-dpi-100', kind: 'scan-with-text', verdict: 'aligned', image: 'poor',
    nota: 'nessun OCR può recuperare dettaglio assente: si avvisa senza offrire rimedi' },
  { file: 'immagine/img-04-contrasto-basso', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-05-illuminazione', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-06-inclinata-3gradi', kind: 'scan-with-text', verdict: 'misaligned',
    nota: 'scansione storta con layer dritto: è disallineamento vero' },
  { file: 'immagine/img-07-sfocata', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'la sfocatura da sola NON deve bastare a generare un allarme' },
  { file: 'immagine/img-08-mrc', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-09-strisce', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-10-ctm-ruotato', kind: 'scan-with-text', verdict: 'misaligned' },
  { file: 'immagine/img-11-smask', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-12-indexed', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-13-xobject-condiviso', kind: 'scan-with-text', verdict: 'aligned' },
  { file: 'immagine/img-14-g4-grande', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'CCITT G4: formato dominante negli allegati PEC, deve funzionare' }
]

// ─── difetti di codifica: geometria sana, testo inservibile ──────────────────
const TESTO: Atteso[] = [
  { file: 'testo/txt-01-no-tounicode', kind: 'scan-with-text', verdict: 'misaligned', text: 'poor' },
  { file: 'testo/txt-02-pua', kind: 'scan-with-text', verdict: 'misaligned', text: 'good',
    nota: 'dai glifi PUA non si estrae testo valutabile: la qualità si astiene, ma la geometria lo segnala comunque' },
  { file: 'testo/txt-03-fffd', kind: 'scan-with-text', verdict: 'aligned', text: 'poor',
    nota: 'geometria perfetta: a coglierlo è solo il punteggio linguistico' },
  { file: 'testo/txt-04-lingua-sbagliata', kind: 'scan-with-text', verdict: 'aligned', text: 'suspect' },
  { file: 'testo/txt-05-caratteri-isolati', kind: 'scan-with-text', verdict: 'misaligned', text: 'poor' },
  { file: 'testo/txt-06-testo-visibile', kind: 'scan-with-text', verdict: 'aligned', text: 'good' },
  { file: 'testo/txt-07-doppio-layer', kind: 'scan-with-text', verdict: 'aligned', text: 'good' }
]

// ─── limiti dichiarati: NON sono regressioni ─────────────────────────────────
const NON_COPERTI: Atteso[] = [
  { file: 'noti-non-coperti/nc-01-xerox-jbig2', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'cifre sostituite DENTRO l\'immagine: testo e pixel concordano, sono entrambi sbagliati' },
  { file: 'noti-non-coperti/nc-02-layer-incompleto', kind: 'scan-with-text', verdict: 'aligned',
    nota: 'layer allineato ma incompleto: la geometria non può accorgersene' }
]

function verifica(gruppo: string, casi: Atteso[]): void {
  describe(gruppo, () => {
    for (const c of casi) {
      const titolo = c.nota ? `${c.file} — ${c.nota}` : c.file
      it(titolo, async () => {
        const path = join(CORPUS, `${c.file}.pdf`)
        expect(existsSync(path), `fixture mancante: ${c.file}.pdf`).toBe(true)
        const r = await analyzeOcrLayer(path)
        expect(r.layerKind).toBe(c.kind)
        expect(r.verdict).toBe(c.verdict)
        if (c.image) expect(r.imageQuality).toBe(c.image)
        if (c.text) expect(r.textQuality).toBe(c.text)
        // Il report non deve mai contenere testo del documento (CLAUDE.md §6).
        expect(JSON.stringify(r)).not.toMatch(/Mario Rossi|RSSMRA80A01H501U|Giulia Bianchi/)
      }, 60000)
    }
  })
}

describe('corpus OCR — Gate A', () => {
  verifica('negativi (nessun allarme)', NEGATIVI)
  verifica('geometrici (devono essere rilevati)', GEOMETRICI)
  verifica('qualità immagine', IMMAGINE)
  verifica('difetti di codifica', TESTO)
  verifica('limiti dichiarati', NON_COPERTI)
})
