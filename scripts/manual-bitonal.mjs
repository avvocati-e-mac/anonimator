import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()

for (const executable of ['pdfimages', 'pdftoppm']) {
  const probe = spawnSync(executable, ['-v'], { cwd: root, stdio: 'ignore' })
  if (probe.error || probe.status !== 0) {
    process.stderr.write('MANUAL_BITONAL_PREREQUISITE_MISSING\n')
    process.exit(2)
  }
}

const outputRoot = join(root, 'manual-test-output')
await mkdir(outputRoot, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDirectory = join(outputRoot, `bitonal-${stamp}-${randomBytes(3).toString('hex')}`)
await mkdir(runDirectory)

const vitest = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'vitest.cmd')
  : join(root, 'node_modules', '.bin', 'vitest')
const result = spawnSync(vitest, ['run'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    ANONIMATOR_MANUAL_BITONAL: '1',
    ANONIMATOR_MANUAL_BITONAL_DIR: runDirectory,
  },
})

if (result.error || result.status !== 0) {
  process.stderr.write('MANUAL_BITONAL_FAILED\n')
  process.exit(result.status ?? 1)
}

process.stdout.write(`MANUAL_BITONAL_OK\n${runDirectory}\n`)
