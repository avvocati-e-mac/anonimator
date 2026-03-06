/**
 * afterPack hook per electron-builder.
 *
 * Rimuove gli xattr di iCloud/Finder dai binari prima del codesign.
 * Senza questo step, codesign fallisce con:
 *   "resource fork, Finder information, or similar detritus not allowed"
 *
 * Viene eseguito solo su macOS (gli altri OS non hanno xattr nel senso macOS).
 */

const { execSync } = require('child_process')
const path = require('path')

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context

  if (electronPlatformName !== 'darwin') return

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  console.log(`[afterPack] Pulizia xattr su: ${appPath}`)
  try {
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' })
    console.log('[afterPack] xattr -cr completato.')
  } catch (err) {
    console.error('[afterPack] Errore durante xattr -cr:', err.message)
    // Non blocca la build — meglio provare il codesign che fallire qui
  }
}
