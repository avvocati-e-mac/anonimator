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
