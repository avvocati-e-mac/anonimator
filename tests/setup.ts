import { vi } from 'vitest'

// Nessun test deve aprire il transport file predefinito di electron-log:
// oltre a sporcare la macchina, potrebbe serializzare dati delle fixture fuori
// dalla directory temporanea controllata dalla suite.
const noop = vi.fn()
vi.mock('electron-log', () => ({
  default: {
    initialize: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    transports: { file: { level: false }, console: { level: false } },
  },
}))
