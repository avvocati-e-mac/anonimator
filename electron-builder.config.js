/**
 * Configurazione electron-builder per Anonimator
 *
 * Build macOS arm64:  npm run dist:mac:arm64
 * Build macOS x64:    npm run dist:mac:x64
 * Build Windows x64:  npm run dist:win  (da Windows o CI)
 *
 * NOTA: gli script dist:mac:* installano i binari sharp corretti per l'arch
 * prima del packaging e ripristinano quelli locali dopo.
 */

/** @type {import('electron-builder').Configuration} */
module.exports = {
  beforePack: './beforePack.js',
  afterPack: './afterPack.js',

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
    // arch viene passata da CLI (--arm64 / --x64).
    // Usa: npm run dist:mac:arm64  (solo arm64)
    //      npm run dist:mac:x64   (solo x64)
    //      npm run dist:mac:both  (entrambi, script automatico)
    // Universal binary NON supportato: sharp usa .dylib arch-specific
    // non mergeable con lipo (lovell/sharp#3622).
    target: [
      { target: 'dmg' }
    ],
    // Per distribuire senza firma Apple Developer: rimuovere hardenedRuntime
    // e notarization dal workflow CI. Per distribuzione interna va bene così.
    hardenedRuntime: false,
    gatekeeperAssess: false,
    identity: null,
    // Icona: metti un file build-resources/icon.icns (1024x1024 consigliato)
    icon: 'build-resources/icon.icns'
  },

  dmg: {
    title: 'Anonimator',
    // es. Anonimator-1.0.0-arm64.dmg  /  Anonimator-1.0.0-x64.dmg
    artifactName: '${productName}-${version}-${arch}.${ext}',
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
    installerHeaderIcon: 'build-resources/icon.ico',
    // es. Anonimator-1.0.0-windows-x64-setup.exe
    artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}'
  },

  // ── Moduli nativi ─────────────────────────────────────────────────────────────
  // mupdf e @huggingface/transformers contengono WASM/binari che non funzionano
  // dentro asar — vanno estratti a filesystem.
  // sharp (@huggingface/transformers lo trascina) usa binari platform-specific
  // in @img/sharp-*: devono stare fuori dall'asar insieme a sharp stesso.
  // onnxruntime-node usa require('../bin/napi-v3/darwin/arm64/onnxruntime_binding.node')
  // — i file .node e .dylib non possono essere dlopen() dall'interno di un asar.
  asar: true,
  asarUnpack: [
    'node_modules/mupdf/**/*',
    'node_modules/@huggingface/transformers/**/*',
    'node_modules/onnxruntime-node/**/*',
    'node_modules/onnxruntime-common/**/*',
    'node_modules/sharp/**/*',
    'node_modules/@img/**/*',
    'node_modules/tesseract.js/**/*',
    'node_modules/tesseract.js-core/**/*'
  ]
}
