// ── Fix asar unpack per moduli nativi su Windows ──────────────────────────────
// Su Windows, Node non riesce a dlopen() file .node dall'interno di un asar.
// electron-builder estrae i moduli in app.asar.unpacked/ ma il require di
// onnxruntime-node (e altri) usa __dirname che punta ancora dentro app.asar.
// Questa patch intercetta Module._resolveFilename e reindirizza i path dei
// moduli nativi verso app.asar.unpacked prima che vengano caricati.
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const Module = _require('module') as { _resolveFilename: (...args: unknown[]) => string }
const _origResolve = Module._resolveFilename.bind(Module)
Module._resolveFilename = function (request: unknown, ...rest: unknown[]): string {
  const resolved: string = _origResolve(request, ...rest)
  if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
    if (resolved.endsWith('.node') || resolved.includes('onnxruntime')) {
      return resolved.replace('app.asar', 'app.asar.unpacked')
    }
  }
  return resolved
}
// ─────────────────────────────────────────────────────────────────────────────

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipcHandlers'
import log from 'electron-log'

log.initialize()
log.info('App avviata', { version: app.getVersion() })

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 700,
    minHeight: 500,
    title: 'Anonimator',
    webPreferences: {
      // Sicurezza: renderer isolato, senza accesso diretto a Node.js
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  // Impedisce la navigazione verso URL esterni
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault()
      log.warn('Navigazione esterna bloccata', { url })
    }
  })

  // In sviluppo carica il dev server Vite; in produzione il file HTML buildato
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Blocco sicurezza: impedisce apertura di nuove finestre Electron
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    log.warn('Tentativo di webview bloccato')
  })
})
