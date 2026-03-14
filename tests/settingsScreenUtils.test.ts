import { describe, it, expect } from 'vitest'

// Replica locale delle funzioni pure estratte da SettingsScreen
// (evita di importare il componente React che richiede un ambiente browser completo)

const LLM_PRESETS = {
  ollama:   { label: 'Ollama',    providerType: 'ollama',        defaultPort: 11434, path: '/v1' },
  lmstudio: { label: 'LM Studio', providerType: 'openai_compat', defaultPort: 1234,  path: '/v1' },
  mlx:      { label: 'MLX Server', providerType: 'openai_compat', defaultPort: 8080,  path: '/v1' },
  custom:   { label: 'Custom (OpenAI compat)', providerType: 'openai_compat', defaultPort: 11434, path: '/v1' },
} as const
type PresetKey = keyof typeof LLM_PRESETS

function buildBaseUrl(preset: PresetKey, host: string, port?: string): string {
  const { defaultPort, path } = LLM_PRESETS[preset]
  const h = host.trim() || 'localhost'
  const resolvedPort = port?.trim() ? port.trim() : String(defaultPort)
  const hasPort = /:\d+$/.test(h)
  const base = h.startsWith('http') ? h : `http://${h}`
  return `${base}${hasPort ? '' : `:${resolvedPort}`}${path}`
}

function extractPortFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.port || ''
  } catch {
    return ''
  }
}

describe('buildBaseUrl', () => {
  it('usa defaultPort quando porta non è specificata (preset ollama)', () => {
    expect(buildBaseUrl('ollama', 'localhost')).toBe('http://localhost:11434/v1')
  })

  it('usa porta custom esplicita per preset custom', () => {
    expect(buildBaseUrl('custom', 'localhost', '8765')).toBe('http://localhost:8765/v1')
  })

  it('usa porta custom esplicita su host remoto', () => {
    expect(buildBaseUrl('custom', '192.168.1.125', '8765')).toBe('http://192.168.1.125:8765/v1')
  })

  it('usa defaultPort del preset custom se porta è stringa vuota', () => {
    expect(buildBaseUrl('custom', 'localhost', '')).toBe('http://localhost:11434/v1')
  })

  it('non aggiunge porta se host include già la porta', () => {
    expect(buildBaseUrl('custom', '192.168.1.125:9000')).toBe('http://192.168.1.125:9000/v1')
  })

  it('usa defaultPort di lmstudio', () => {
    expect(buildBaseUrl('lmstudio', 'localhost')).toBe('http://localhost:1234/v1')
  })

  it('usa defaultPort di mlx', () => {
    expect(buildBaseUrl('mlx', 'localhost')).toBe('http://localhost:8080/v1')
  })

  it('preserva http:// se già presente', () => {
    expect(buildBaseUrl('ollama', 'http://myserver', undefined)).toBe('http://myserver:11434/v1')
  })
})

describe('extractPortFromUrl', () => {
  it('estrae la porta da un URL con porta esplicita', () => {
    expect(extractPortFromUrl('http://localhost:8765/v1')).toBe('8765')
  })

  it('restituisce stringa vuota se nessuna porta è presente', () => {
    expect(extractPortFromUrl('http://localhost/v1')).toBe('')
  })

  it('estrae la porta da un URL remoto', () => {
    expect(extractPortFromUrl('http://192.168.1.125:9000/v1')).toBe('9000')
  })

  it('restituisce stringa vuota su URL malformato', () => {
    expect(extractPortFromUrl('non-un-url')).toBe('')
  })
})
