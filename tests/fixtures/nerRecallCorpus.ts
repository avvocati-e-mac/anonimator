import type { EntityType } from '../../src/shared/types'

/**
 * Corpus interamente sintetico: nomi, luoghi e identificativi sono inventati.
 * Non sostituire queste fixture con estratti di fascicoli o documenti reali.
 */
export interface NerRecallExpectation {
  type: EntityType
  originalText: string
  occurrences: number
}

export interface NerRecallCase {
  id: string
  category: 'legal' | 'administrative' | 'ocr' | 'negative-control'
  text: string
  expected: NerRecallExpectation[]
}

export const NER_RECALL_CORPUS: readonly NerRecallCase[] = [
  {
    id: 'legal-party-labelled',
    category: 'legal',
    text: '\nRicorrente: Giulia Verdi\ncontro la parte resistente.',
    expected: [{ type: 'PERSONA', originalText: 'Giulia Verdi', occurrences: 1 }],
  },
  {
    id: 'legal-judge-heading',
    category: 'legal',
    text: 'Elena Ferri - Presidente -\nPaolo Neri - Consigliere -',
    expected: [
      { type: 'PERSONA', originalText: 'Elena Ferri', occurrences: 1 },
      { type: 'PERSONA', originalText: 'Paolo Neri', occurrences: 1 },
    ],
  },
  {
    id: 'legal-name-line-break',
    category: 'legal',
    text: 'La parte è assistita dal Sig. Marta\nLeoni nel presente giudizio.',
    expected: [{ type: 'PERSONA', originalText: 'Marta\nLeoni', occurrences: 1 }],
  },
  {
    id: 'administrative-surname-name-table',
    category: 'administrative',
    text: 'DATI DEL RICHIEDENTE\nCognome: Neri\nNome: Luca\nUfficio competente: Sportello Due.',
    expected: [
      { type: 'PERSONA', originalText: 'Neri', occurrences: 1 },
      { type: 'PERSONA', originalText: 'Luca', occurrences: 1 },
    ],
  },
  {
    id: 'administrative-birth-fields',
    category: 'administrative',
    text: 'Luogo di nascita: Cittafinta\nData di nascita: 07/04/1975',
    expected: [
      { type: 'LUOGO_NASCITA', originalText: 'Cittafinta', occurrences: 1 },
      { type: 'DATA_NASCITA', originalText: '07/04/1975', occurrences: 1 },
    ],
  },
  {
    id: 'legal-birth-prose',
    category: 'legal',
    text: 'Il dichiarante, nato a Paesefinto il 12 marzo 1984, espone quanto segue.',
    expected: [
      { type: 'LUOGO_NASCITA', originalText: 'Paesefinto', occurrences: 1 },
      { type: 'DATA_NASCITA', originalText: '12 marzo 1984', occurrences: 1 },
    ],
  },
  {
    id: 'administrative-address-with-cap',
    category: 'administrative',
    text: 'Il richiedente è residente in Via del Gelsomino 12, 00123.',
    expected: [
      { type: 'INDIRIZZO', originalText: 'residente in Via del Gelsomino 12, 00123', occurrences: 1 },
    ],
  },
  {
    id: 'administrative-address-without-cap',
    category: 'administrative',
    text: 'Recapito dichiarato: residente in Via delle Querce 8.',
    expected: [
      { type: 'INDIRIZZO', originalText: 'residente in Via delle Querce 8', occurrences: 1 },
    ],
  },
  {
    id: 'administrative-residence-table',
    category: 'administrative',
    text: 'Residenza:\nViale della Luna 4\nComune: Cittafinta',
    expected: [{ type: 'INDIRIZZO', originalText: 'Viale della Luna 4', occurrences: 1 }],
  },
  {
    id: 'employment-roles',
    category: 'administrative',
    text: 'Datore di lavoro: Officina Gamma S.r.l.\nDipendente: Sara Conti',
    expected: [
      { type: 'ORGANIZZAZIONE', originalText: 'Officina Gamma S.r.l.', occurrences: 1 },
      { type: 'PERSONA', originalText: 'Sara Conti', occurrences: 1 },
    ],
  },
  {
    id: 'isolated-name-with-particle',
    category: 'legal',
    text: 'PARTE COSTITUITA\nPAOLO DE LUCA\nCONCLUSIONI',
    expected: [{ type: 'PERSONA', originalText: 'PAOLO DE LUCA', occurrences: 1 }],
  },
  {
    id: 'structured-identifiers',
    category: 'administrative',
    text: 'Codice fiscale VRDGLI84C52Z404Q; P. IVA 10987654321; e-mail giulia.verdi@example.invalid.',
    expected: [
      { type: 'CODICE_FISCALE', originalText: 'VRDGLI84C52Z404Q', occurrences: 1 },
      { type: 'PARTITA_IVA', originalText: '10987654321', occurrences: 1 },
      { type: 'EMAIL', originalText: 'giulia.verdi@example.invalid', occurrences: 1 },
    ],
  },
  {
    id: 'repeated-email-occurrences',
    category: 'administrative',
    text: 'Inviare a ufficio@example.invalid; per conferma usare ancora ufficio@example.invalid.',
    expected: [{ type: 'EMAIL', originalText: 'ufficio@example.invalid', occurrences: 2 }],
  },
  {
    id: 'ocr-confused-field-labels',
    category: 'ocr',
    text: 'C0GNOME: BIANCHI\nN0ME: ELENA\nLU0G0 Dl NASCITA: Cittafinta',
    expected: [
      { type: 'PERSONA', originalText: 'BIANCHI', occurrences: 1 },
      { type: 'PERSONA', originalText: 'ELENA', occurrences: 1 },
      { type: 'LUOGO_NASCITA', originalText: 'Cittafinta', occurrences: 1 },
    ],
  },
  {
    id: 'ocr-confused-phone',
    category: 'ocr',
    text: 'Recapito telefonico: 333 I234567',
    expected: [{ type: 'TELEFONO', originalText: '333 I234567', occurrences: 1 }],
  },
  {
    id: 'ocr-confused-tax-code',
    category: 'ocr',
    text: 'Codice fiscale: VRDGLI8AC52Z4O4Q',
    expected: [{ type: 'CODICE_FISCALE', originalText: 'VRDGLI8AC52Z4O4Q', occurrences: 1 }],
  },
  {
    id: 'negative-legal-headings',
    category: 'negative-control',
    text: 'TRIBUNALE ORDINARIO\nSVOLGIMENTO DEL PROCESSO\nRICORRENTE\nCONCLUSIONI',
    expected: [],
  },
  {
    id: 'negative-generic-date',
    category: 'negative-control',
    text: 'L’udienza è fissata per il 07/04/1975 nella sala seconda.',
    expected: [],
  },
  {
    id: 'negative-course-word',
    category: 'negative-control',
    text: 'Nel corso delle indagini è stato acquisito il verbale.',
    expected: [],
  },
  {
    id: 'negative-eleven-digit-protocol',
    category: 'negative-control',
    text: 'Numero di protocollo amministrativo: 12345678901.',
    expected: [],
  },
  {
    id: 'negative-plate-shaped-case-code',
    category: 'negative-control',
    text: 'Codice interno della pratica: AB 123 CD.',
    expected: [],
  },
]
