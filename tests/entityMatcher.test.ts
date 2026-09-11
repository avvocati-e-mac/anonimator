import { describe, expect, it } from 'vitest'
import { matchEntitiesOnPage, type MatchWord } from '../src/main/services/entityMatcher'

function words(...text: string[]): MatchWord[] {
  return text.map((value, index) => ({
    text: value,
    line: Math.floor(index / 2),
    bbox: { x0: index * 20, y0: Math.floor(index / 2) * 20, x1: index * 20 + 15, y1: Math.floor(index / 2) * 20 + 10 }
  }))
}

describe('matchEntitiesOnPage', () => {
  it('normalizza NFKC, maiuscole, whitespace e punteggiatura esterna', () => {
    const result = matchEntitiesOnPage(words('«Ｍａｒｉｏ', 'Rossi,»'), [{
      entityId: 'e1', type: 'PERSONA', originalText: 'Mario\n Rossi'
    }], { page: 2 })
    expect(result).toEqual([{
      entityId: 'e1', page: 2, wordStart: 0, wordEnd: 1,
      box: { x0: 0, y0: 0, x1: 35, y1: 10 }, status: 'matched'
    }])
  })

  it('ricompone una parola sillabata attraverso un a-capo', () => {
    const result = matchEntitiesOnPage(words('ammini-', 'strazione', 'comunale'), [{
      entityId: 'e1', type: 'ORGANIZZAZIONE', originalText: 'Amministrazione comunale'
    }], { page: 0 })
    expect(result[0]).toMatchObject({ wordStart: 0, wordEnd: 2, status: 'matched' })
  })

  it.each([
    ['CODICE_FISCALE' as const, 'RSSMRA 80A01 H501U', ['RSSMRA80A01H501U']],
    ['IBAN' as const, 'IT60 X054 2811 1010 0000 0123 456', ['IT60X0542811101000000123456']],
    ['NUMERO_DOCUMENTO' as const, 'CA 12345', ['CA', '12345']],
    ['TARGA' as const, 'AB 123 CD', ['AB123CD']]
  ])('usa equivalenze esatte di formato per %s', (type, originalText, tokens) => {
    expect(matchEntitiesOnPage(words(...tokens), [{ entityId: 'e', type, originalText }], { page: 0 })[0].status)
      .toBe('matched')
  })

  it('non applica fuzzy matching ai codici strutturati', () => {
    const result = matchEntitiesOnPage(words('RSSMRA80A01H501V'), [{
      entityId: 'cf', type: 'CODICE_FISCALE', originalText: 'RSSMRA80A01H501U'
    }], { page: 0 })
    expect(result[0].status).toBe('unmatched')
  })

  it('marca tutti i match incompatibili come ambiguous', () => {
    const result = matchEntitiesOnPage(words('Mario', 'Rossi'), [
      { entityId: 'nome-completo', type: 'PERSONA', originalText: 'Mario Rossi' },
      { entityId: 'cognome', type: 'PERSONA', originalText: 'Rossi' }
    ], { page: 0 })
    expect(result.map(({ entityId, status }) => ({ entityId, status }))).toEqual([
      { entityId: 'nome-completo', status: 'ambiguous' },
      { entityId: 'cognome', status: 'ambiguous' }
    ])
  })

  it('propaga l ambiguita lungo una catena di overlap', () => {
    const result = matchEntitiesOnPage(words('Mario', 'Rossi', 'Junior'), [
      { entityId: 'a', type: 'PERSONA', originalText: 'Mario Rossi' },
      { entityId: 'b', type: 'PERSONA', originalText: 'Rossi' },
      { entityId: 'c', type: 'PERSONA', originalText: 'Rossi Junior' }
    ], { page: 0 })
    expect(result.map(({ status }) => status)).toEqual(['ambiguous', 'ambiguous', 'ambiguous'])
  })

  it('conserva rettangoli rifiutati nel ledger', () => {
    const result = matchEntitiesOnPage(words('Mario', 'Rossi'), [{
      entityId: 'e1', type: 'PERSONA', originalText: 'Mario Rossi'
    }], { page: 4, acceptRect: () => false })
    expect(result[0]).toMatchObject({
      entityId: 'e1', page: 4, wordStart: 0, wordEnd: 1, status: 'rejected'
    })
    expect(result[0].box).not.toBeNull()
  })

  it('registra unmatched e bbox non validi senza inventare coordinate', () => {
    const invalidWords = words('Mario')
    invalidWords[0].bbox.x1 = Number.NaN
    expect(matchEntitiesOnPage(invalidWords, [{
      entityId: 'bad-box', type: 'PERSONA', originalText: 'Mario'
    }, {
      entityId: 'absent', type: 'PERSONA', originalText: 'Giulia'
    }], { page: 0 })).toEqual([
      { entityId: 'bad-box', page: 0, wordStart: 0, wordEnd: 0, box: null, status: 'rejected' },
      { entityId: 'absent', page: 0, wordStart: null, wordEnd: null, box: null, status: 'unmatched' }
    ])
  })
})
