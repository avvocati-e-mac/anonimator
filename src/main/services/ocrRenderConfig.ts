/**
 * Configurazione di rendering condivisa fra l'OCR e il generatore PDF.
 *
 * PERCHÉ ESISTE QUESTO MODULO
 * Il DPI con cui una pagina viene renderizzata per l'OCR e il DPI usato per
 * registrare la matrice dell'artefatto OCR **devono essere lo stesso numero**.
 * Prima erano due costanti scritte a mano in parser e generatore: finché il
 * valore era fisso funzionava per caso, ma rendendolo variabile la geometria
 * delle redazioni avrebbe potuto divergere senza alcun errore visibile.
 *
 * Regola: il DPI si PASSA, non si ricalcola.
 */

/** DPI di rendering predefinito per l'OCR.
 *
 *  300 e non 150: la documentazione Tesseract indica l'altezza della x in
 *  pixel come diagnostica e colloca sotto i 10px la soglia oltre la quale ci
 *  sono «pochissime probabilità di risultati accurati». A 150 DPI una riga da
 *  10pt sta esattamente su ~10px, cioè sul limite di fallimento. */
export const OCR_RENDER_DPI_DEFAULT = 300

/** Limite inferiore: sotto, il testo corpo non è più risolto. */
export const OCR_RENDER_DPI_MIN = 200

/** Limite superiore. Più DPI NON è sempre meglio: su pagine dattiloscritte è
 *  misurata un'accuratezza del 90,49% a 300 DPI contro il 47,60% a 600, perché
 *  oltre una certa dimensione i glifi escono dalla scala attesa dal motore LSTM. */
export const OCR_RENDER_DPI_MAX = 400

export const PDF_POINTS_PER_INCH = 72

/**
 * DPI di rendering da usare per un dato raster.
 *
 * Renderizzare sopra la risoluzione nativa dell'immagine incorporata è pura
 * interpolazione: non aggiunge dettaglio e costa tempo e memoria. Quando il
 * DPI nativo è noto lo si segue, entro i limiti sopra.
 */
export function resolveOcrDpi(nativeDpi: number | null | undefined): number {
  if (nativeDpi === null || nativeDpi === undefined || !Number.isFinite(nativeDpi)) {
    return OCR_RENDER_DPI_DEFAULT
  }
  return Math.min(OCR_RENDER_DPI_MAX, Math.max(OCR_RENDER_DPI_MIN, Math.round(nativeDpi)))
}

/** Fattore di scala punti→pixel per un dato DPI, usato per costruire la
 * matrice registrata insieme all'artefatto OCR token-bound. */
export function dpiToScale(dpi: number): number {
  return dpi / PDF_POINTS_PER_INCH
}
