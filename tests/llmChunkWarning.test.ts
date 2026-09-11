import { describe, it, expect } from 'vitest'
import { buildLlmChunkErrorWarning } from '../src/main/services/nerService'

describe('buildLlmChunkErrorWarning', () => {
  it('quando nessuna sezione è stata analizzata lo dice e spiega cosa fare', () => {
    const m = buildLlmChunkErrorWarning(18, 18)
    expect(m).toContain('nessuna delle 18 sezioni')
    expect(m).toContain('solo da regex e BERT')
    // Il punto del messaggio: chi legge deve sapere che cosa può fare.
    expect(m).toMatch(/Ollama/)
    expect(m).toMatch(/Impostazioni/)
  })

  it('quando il guasto è parziale non allarma come se fosse totale', () => {
    const m = buildLlmChunkErrorWarning(3, 18)
    expect(m).toContain('3 sezioni')
    expect(m).toContain('di 18')
    expect(m).not.toContain('nessuna')
  })

  it('accorda il singolare', () => {
    expect(buildLlmChunkErrorWarning(1, 18)).toContain('1 sezione di 18')
  })

  it('non parla più di un generico "errore del server"', () => {
    // Era la formulazione che non diceva di quale server si trattasse.
    expect(buildLlmChunkErrorWarning(18, 18)).not.toContain('errore del server')
    expect(buildLlmChunkErrorWarning(2, 18)).not.toContain('errore del server')
  })

  it('regge un conteggio di sezioni pari a zero senza affermare assurdità', () => {
    expect(buildLlmChunkErrorWarning(0, 0)).not.toContain('nessuna delle 0')
  })
})
