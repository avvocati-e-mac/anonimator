import { describe, it, expect } from 'vitest'
import {
  buildOcrProgressMessage,
  formatRemainingOcrTime,
  ocrProgressPercent
} from '../src/main/services/ocrProgressMessage'

const T0 = 1_000_000

describe('formatRemainingOcrTime', () => {
  it('non stima nulla finché nessuna pagina è conclusa', () => {
    // Un numero inventato al primo secondo è peggio di nessun numero.
    expect(formatRemainingOcrTime(T0, 0, 23, T0 + 2000)).toBe('')
  })

  it('non stima nulla sull\'ultima pagina', () => {
    expect(formatRemainingOcrTime(T0, 23, 23, T0 + 120_000)).toBe('')
  })

  it('con una pagina conclusa proietta sulle restanti', () => {
    // 1 pagina in 6 s, ne restano 22 → ~132 s ≈ 2 minuti.
    expect(formatRemainingOcrTime(T0, 1, 23, T0 + 6000)).toBe(' — circa 2 minuti')
  })

  it('usa la media, non l\'ultima pagina', () => {
    // 10 pagine in 50 s → 5 s/pagina; ne restano 10 → 50 s ≈ 1 minuto.
    expect(formatRemainingOcrTime(T0, 10, 20, T0 + 50_000)).toBe(' — circa 1 minuto')
  })

  it('sotto i 45 secondi non dà un numero di minuti', () => {
    // 20 pagine in 40 s → 2 s/pagina; ne restano 3 → 6 s.
    expect(formatRemainingOcrTime(T0, 20, 23, T0 + 40_000)).toBe(' — meno di un minuto')
  })

  it('singolare e plurale', () => {
    expect(formatRemainingOcrTime(T0, 1, 2, T0 + 60_000)).toBe(' — circa 1 minuto')
    expect(formatRemainingOcrTime(T0, 1, 6, T0 + 60_000)).toBe(' — circa 5 minuti')
  })

  it('non produce NaN né Infinity con tempi degeneri', () => {
    expect(formatRemainingOcrTime(T0, 5, 23, T0)).toBe('')
    expect(formatRemainingOcrTime(T0, 5, 23, T0 - 1000)).toBe('')
  })
})

describe('ocrProgressPercent', () => {
  it('occupa la banda 30-48%', () => {
    expect(ocrProgressPercent(0, 23)).toBe(30)
    expect(ocrProgressPercent(23, 23)).toBe(48)
  })

  it('cresce in modo monotono e non esce dalla banda', () => {
    let precedente = -1
    for (let p = 0; p <= 23; p++) {
      const v = ocrProgressPercent(p, 23)
      expect(v).toBeGreaterThanOrEqual(precedente)
      expect(v).toBeGreaterThanOrEqual(30)
      expect(v).toBeLessThanOrEqual(48)
      precedente = v
    }
  })

  it('non divide per zero su un documento senza pagine', () => {
    expect(ocrProgressPercent(0, 0)).toBe(30)
  })

  it('regge una pagina fuori scala senza superare la banda', () => {
    expect(ocrProgressPercent(99, 23)).toBe(48)
  })
})

describe('buildOcrProgressMessage', () => {
  it('dice a che pagina è e quanto manca', () => {
    expect(buildOcrProgressMessage(4, 23, T0, 3, T0 + 18_000)).toBe(
      'Riconoscimento del testo: pagina 4 di 23 — circa 2 minuti'
    )
  })

  it('alla prima pagina dice solo dov\'è', () => {
    expect(buildOcrProgressMessage(1, 23, T0, 0, T0 + 500)).toBe(
      'Riconoscimento del testo: pagina 1 di 23'
    )
  })

  it('non contiene nulla che venga dal documento', () => {
    const m = buildOcrProgressMessage(4, 23, T0, 3, T0 + 18_000)
    expect(m).toMatch(/^Riconoscimento del testo: pagina \d+ di \d+( — [^—]+)?$/)
  })
})
