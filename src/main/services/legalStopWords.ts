// ============================================================
// Veto filter post-NER: parole/ruoli giuridici che il modello
// BERT a volte classifica erroneamente come PERSONA.
// Applicato SOLO alle entità di source 'ner' — non alle entità
// rilevate dal layer regex contestuale (Step 0b).
// ============================================================

/**
 * Ruoli processuali e istituzionali in italiano che non devono
 * essere anonimizzati come PERSONA.
 * Tutti in lowercase — confrontare sempre con .toLowerCase().
 */
export const LEGAL_STOP_WORDS = new Set<string>([
  // Ruoli processuali civili
  'ricorrente',
  'resistente',
  'appellante',
  'appellato',
  'intimato',
  'controricorrente',
  'opponente',
  'opposto',
  'attore',
  'convenuto',
  'debitore',
  'creditore',
  'istante',
  'intervenuto',
  'intervenuta',
  // Ruoli processuali penali
  'imputato',
  'imputata',
  'querelante',
  'querelato',
  'accusato',
  'accusata',
  'indagato',
  'indagata',
  'condannato',
  'condannata',
  // Testimoni e periti
  'testimone',
  'perito',
  'ctu',
  'ctp',
  'consulente',
  // Organi giudiziari
  'tribunale',
  'corte',
  'sezione',
  'collegio',
  'repubblica',
  'stato',
  // Ruoli giudiziari
  'presidente',
  'relatore',
  'giudice',
  'giudice istruttore',
  'consigliere',
  'cancelliere',
  // Ruoli del PM
  'procura',
  'procuratore',
  'sostituto',
  'requirente',
  // Avvocatura e difesa
  'difensore',
  'difesa',
  'avvocatura',
  // Enti amministrativi
  'ministero',
  'questura',
  'prefettura',
  'commissariato',
])
