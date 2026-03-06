/**
 * beforePack hook per electron-builder.
 *
 * Pulisce gli xattr iCloud/Finder dai binari Electron PRIMA che vengano
 * copiati nell'app bundle. Questo è il punto critico: afterPack arriva
 * tardi perché electron-builder copia i Framework già con gli xattr e poi
 * li firma individualmente prima che afterPack possa intervenire.
 *
 * Pulisce anche il file entitlements.mac.plist che può avere xattr che
 * impediscono la lettura da parte di codesign.
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

/** @param {import('electron-builder').BeforePackContext} context */
exports.default = async function beforePack(context) {
  const { electronPlatformName, packager } = context

  if (electronPlatformName !== 'darwin') return

  // 1. Pulisci Electron.app sorgente in node_modules
  const electronDist = path.join(
    packager.projectDir,
    'node_modules',
    'electron',
    'dist',
    'Electron.app'
  )
  if (fs.existsSync(electronDist)) {
    console.log(`[beforePack] Pulizia xattr su Electron.app sorgente...`)
    try {
      execSync(`xattr -cr "${electronDist}"`, { stdio: 'inherit' })
      console.log('[beforePack] Electron.app: xattr rimossi.')
    } catch (err) {
      console.error('[beforePack] Errore xattr su Electron.app:', err.message)
    }
  }

  // 2. Pulisci il plist degli entitlements (può avere xattr che impediscono la lettura)
  const plistPath = path.join(
    packager.projectDir,
    'node_modules',
    'app-builder-lib',
    'templates',
    'entitlements.mac.plist'
  )
  if (fs.existsSync(plistPath)) {
    console.log('[beforePack] Pulizia xattr su entitlements.mac.plist...')
    try {
      execSync(`xattr -c "${plistPath}"`, { stdio: 'inherit' })
      console.log('[beforePack] entitlements.mac.plist: xattr rimossi.')
    } catch (err) {
      console.error('[beforePack] Errore xattr su plist:', err.message)
    }
  }

  // 3. Pulisci l'intera cartella node_modules/electron/dist per sicurezza
  const electronDistDir = path.join(packager.projectDir, 'node_modules', 'electron', 'dist')
  if (fs.existsSync(electronDistDir)) {
    try {
      execSync(`xattr -cr "${electronDistDir}"`, { stdio: 'inherit' })
    } catch (_) {
      // silenzioso — già tentato sopra
    }
  }
}
