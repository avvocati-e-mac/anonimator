/**
 * Configurazione electron-builder per Anonimator
 *
 * Build macOS arm64:  npm run dist:mac:arm64
 * Build macOS x64:    npm run dist:mac:x64
 * Build Windows x64:  npm run dist:win  (da Windows o CI)
 *
 * NOTA: sharp usa binari prebuilt (@img/sharp-darwin-arm64 / x64).
 * Prima di ogni build, npm install installa automaticamente i binari
 * per l'arch corrente. Il hook beforePack installa quelli mancanti.
 */
const { execSync } = require('child_process')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Hook eseguito prima del packaging: installa i binari sharp per l'arch target
  beforePack: async (context) => {
    const arch = context.arch === 3 ? 'arm64' : 'x64'  // 3 = Arch.arm64 in electron-builder
    const platform = context.electronPlatformName  // 'darwin' | 'win32'
    if (platform === 'darwin') {
      console.log(`[beforePack] Installazione binari sharp per darwin-${arch}...`)
      execSync(`npm install --os=darwin --cpu=${arch} sharp`, { stdio: 'inherit' })
    }
  },
  appId: 'it.anonimator.app',
  productName: 'Anonimator',
  copyright: 'Copyright © 2025',

  // Cartella sorgente (output di electron-vite build)
  directories: {
    output: 'dist',
    buildResources: 'build-resources'
  },

  // File da includere nel pacchetto
  files: [
    'out/**/*',
    'package.json',
    'node_modules/**/*',
    // Escludi sorgenti e file di sviluppo non necessari a runtime
    '!node_modules/*/{CHANGELOG.md,README.md,readme.md,*.d.ts}',
    '!node_modules/*/{test,__tests__,tests,powered-test,example,examples}/**',
    '!node_modules/.bin/**',
    '!**/{.DS_Store,.git,.hg,.svn,CVS,Thumbs.db}'
  ],

  // Risorse extra da copiare nella cartella risorse dell'app
  // Devono essere nella stessa posizione dove il codice le cerca a runtime:
  //   app.getAppPath() + '/resources/...'
  extraResources: [
    {
      from: 'resources/models',
      to: 'resources/models',
      filter: ['**/*']
    },
    {
      from: 'resources/tessdata',
      to: 'resources/tessdata',
      filter: ['**/*']
    }
  ],

  // ── macOS ────────────────────────────────────────────────────────────────────
  mac: {
    category: 'public.app-category.productivity',
    // Costruiamo separatamente arm64 e x64 per evitare problemi
    // con i binari prebuilt di sharp che sono arch-specific.
    // Usa: npm run dist:mac:arm64  oppure  npm run dist:mac:x64
    // arch viene sovrascritta da --arm64 / --x64 passati da CLI
    // Default: solo arch nativa per evitare conflitti con binari sharp
    target: [
      { target: 'dmg', arch: ['arm64'] }
    ],
    // Per distribuire senza firma Apple Developer: rimuovere hardenedRuntime
    // e notarization dal workflow CI. Per distribuzione interna va bene così.
    hardenedRuntime: false,
    gatekeeperAssess: false,
    // Icona: metti un file build-resources/icon.icns (1024x1024 consigliato)
    icon: 'build-resources/icon.icns'
  },

  dmg: {
    title: 'Anonimator',
    contents: [
      { x: 130, y: 220, type: 'file' },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ],
    window: { width: 540, height: 380 }
  },

  // ── Windows ──────────────────────────────────────────────────────────────────
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] }
    ],
    // Icona: metti un file build-resources/icon.ico (256x256 consigliato)
    icon: 'build-resources/icon.ico'
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Anonimator',
    installerHeaderIcon: 'build-resources/icon.ico'
  },

  // ── Moduli nativi ─────────────────────────────────────────────────────────────
  // mupdf e @huggingface/transformers contengono WASM/binari che non funzionano
  // dentro asar — vanno estratti a filesystem.
  // sharp (@huggingface/transformers lo trascina) usa binari platform-specific
  // in @img/sharp-*: devono stare fuori dall'asar insieme a sharp stesso.
  asar: true,
  asarUnpack: [
    'node_modules/mupdf/**/*',
    'node_modules/@huggingface/transformers/**/*',
    'node_modules/sharp/**/*',
    'node_modules/@img/**/*',
    'node_modules/tesseract.js/**/*',
    'node_modules/tesseract.js-core/**/*'
  ]
}
