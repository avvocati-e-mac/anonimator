import type { PdfGenerateOptions } from '../outputGenerators/pdfGenerator'
import type { PdfOutputMode } from '@shared/types'

export type PdfRasterCodec = NonNullable<PdfGenerateOptions['rasterCodec']>

/**
 * Traduce la preferenza semantica validata dall'IPC nell'opzione Main-only.
 * Il Renderer non può scegliere nomi di codec o soglie interne.
 */
export function resolvePdfRasterCodec(mode: PdfOutputMode | undefined): PdfRasterCodec | undefined {
  return mode === 'force-bitonal' ? 'bitonal-force' : undefined
}
