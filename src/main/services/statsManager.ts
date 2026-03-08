import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log'
import type { ElaborationStats } from '@shared/types'

const MAX_ENTRIES = 200

export class StatsManager {
  private entries: ElaborationStats[] = []
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    this.load()
  }

  record(stats: ElaborationStats): void {
    this.entries.unshift(stats)
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES)
    }
    this.persist()
    log.info('Stats registrate', {
      fileName: stats.fileName,
      format: stats.format,
      totalMs: stats.phases.total.durationMs,
      entities: stats.entitiesFound,
    })
  }

  getAll(): ElaborationStats[] {
    return this.entries
  }

  clear(): void {
    this.entries = []
    this.persist()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf-8')
      this.entries = JSON.parse(raw) as ElaborationStats[]
    } catch { /* file corrotto: ignora, riparte con array vuoto */ }
  }

  private persist(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8')
    } catch (err) {
      log.error('StatsManager: errore scrittura', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

// Singleton
export let statsManager: StatsManager

export function initStatsManager(): void {
  const filePath = join(app.getPath('userData'), 'anonimator-stats.json')
  statsManager = new StatsManager(filePath)
}
