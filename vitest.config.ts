import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'path'

const manualBitonal = process.env.ANONIMATOR_MANUAL_BITONAL === '1'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: manualBitonal ? ['tests/manual/bitonalManual.test.ts'] : configDefaults.include,
    exclude: manualBitonal ? configDefaults.exclude : [...configDefaults.exclude, 'tests/manual/**'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
