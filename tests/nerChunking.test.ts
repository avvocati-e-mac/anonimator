import { describe, it, expect } from 'vitest'
import { createOverlappingChunks } from '../src/main/services/nerService'

describe('createOverlappingChunks', () => {
  it('restituisce testo intero se < chunkSize', () => {
    const tokens = ['parola1', 'parola2', 'parola3']
    const chunks = createOverlappingChunks(tokens, 400, 40)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('parola1 parola2 parola3')
  })

  it('restituisce testo intero se esattamente chunkSize', () => {
    const tokens = Array.from({ length: 400 }, (_, i) => `word${i}`)
    const chunks = createOverlappingChunks(tokens, 400, 40)
    expect(chunks).toHaveLength(1)
  })

  it('crea più chunk con stride = chunkSize - overlap', () => {
    // 401 token, chunkSize=400, overlap=40 → stride=360
    // chunk 1: [0..399], chunk 2: [360..400] → 2 chunk
    const tokens = Array.from({ length: 401 }, (_, i) => `word${i}`)
    const chunks = createOverlappingChunks(tokens, 400, 40)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  it('il secondo chunk contiene i token finali del primo (overlap)', () => {
    const tokens = Array.from({ length: 500 }, (_, i) => `word${i}`)
    const chunks = createOverlappingChunks(tokens, 400, 40)
    // Chunk 1: word0..word399, Chunk 2: word360..word499
    // I token 360-399 devono apparire in entrambi
    expect(chunks[0]).toContain('word360')
    expect(chunks[1]).toContain('word360')
  })

  it('entità a cavallo del boundary è visibile nel chunk sovrapposto', () => {
    // Costruiamo token dove MARIO è l'ultimo del chunk 1 e ROSSI è il primo del chunk 2
    // senza overlap: MARIO ROSSI sarebbe spezzato
    // con overlap (stride=360): il chunk 2 inizia a token 360, quindi vede entrambi
    const tokens = [
      ...Array.from({ length: 398 }, (_, i) => `word${i}`),
      'MARIO',    // token 398 — fine chunk 1 (index 399 = fuori range)
      'ROSSI',    // token 399 — inizio chunk 2
      ...Array.from({ length: 100 }, (_, i) => `extra${i}`)
    ]
    const chunks = createOverlappingChunks(tokens, 400, 40)
    // Il chunk 2 inizia a token 360 → contiene sia MARIO (398) che ROSSI (399)
    const chunk2 = chunks[1]
    expect(chunk2).toContain('MARIO')
    expect(chunk2).toContain('ROSSI')
    // Verifica che appaiano contigui
    expect(chunk2).toContain('MARIO ROSSI')
  })

  it('non genera chunk vuoti', () => {
    const tokens = Array.from({ length: 800 }, (_, i) => `w${i}`)
    const chunks = createOverlappingChunks(tokens, 400, 40)
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0)
    }
  })

  it('il numero di chunk aumenta di circa 11% rispetto al chunking senza overlap', () => {
    // 4000 token: senza overlap = 10 chunk (400*10), con stride 360 = ~11 chunk
    const tokens = Array.from({ length: 4000 }, (_, i) => `w${i}`)
    const chunks = createOverlappingChunks(tokens, 400, 40)
    // Con stride 360: ceil(4000/360) ≈ 12 chunk
    expect(chunks.length).toBeGreaterThan(10)
    expect(chunks.length).toBeLessThan(15)
  })
})
