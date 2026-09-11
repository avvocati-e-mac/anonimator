import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const MAIN_ROOT = join(process.cwd(), 'src', 'main')
const RENDERER_ROOT = join(process.cwd(), 'src', 'renderer')
const LOGGER_FILE = join(MAIN_ROOT, 'services', 'privacyLogger.ts')

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return typescriptFiles(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

function matchingLines(source: string, pattern: RegExp): number[] {
  return source.split('\n').flatMap((line, index) => pattern.test(line) ? [index + 1] : [])
}

describe('policy statica del logging Main', () => {
  it('consente electron-log soltanto nel privacyLogger centralizzato', async () => {
    const violations: string[] = []
    for (const file of await typescriptFiles(MAIN_ROOT)) {
      const source = await readFile(file, 'utf8')
      const lines = matchingLines(
        source,
        /(?:from\s*|import\s*\(|require\s*\()\s*['"]electron-log['"]/, 
      )
      if (file === LOGGER_FILE) {
        if (lines.length !== 1) violations.push(`${relative(process.cwd(), file)}: import attesi 1, trovati ${lines.length}`)
      } else {
        violations.push(...lines.map((line) => `${relative(process.cwd(), file)}:${line}`))
      }
    }
    expect(violations, `Import electron-log non consentiti:\n${violations.join('\n')}`).toEqual([])
  })

  it('vieta console.* in tutto il runtime applicativo', async () => {
    const violations: string[] = []
    const files = [
      ...await typescriptFiles(MAIN_ROOT),
      ...await typescriptFiles(RENDERER_ROOT),
    ]
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const lines = matchingLines(source, /\bconsole\s*\.\s*(?:debug|error|info|log|trace|warn)\s*\(/)
      violations.push(...lines.map((line) => `${relative(process.cwd(), file)}:${line}`))
    }
    expect(violations, `console.* non consentiti nel runtime:\n${violations.join('\n')}`).toEqual([])
  })
})
