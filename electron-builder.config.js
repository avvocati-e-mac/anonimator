/**
 * Configurazione electron-builder per Anonimator
 *
 * Build macOS:   npm run dist:mac
 * Build Windows: npm run dist:win
 * Build entrambi (da macOS, richiede Wine per .exe): npm run dist
 */

/** @type {import('electron-builder').Configuration} */
module.exports = {
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
    'package.json'
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
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] }
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
  // mupdf contiene binari WASM, non ha bisogno di rebuild nativa
  // ma deve essere incluso nell'asar come file esterno (i WASM non funzionano dentro asar)
  asar: true,
  asarUnpack: [
    'node_modules/mupdf/**/*',
    'node_modules/@huggingface/transformers/**/*',
    'node_modules/sharp/**/*',
    'node_modules/tesseract.js/**/*',
    'node_modules/tesseract.js-core/**/*'
  ]
}
