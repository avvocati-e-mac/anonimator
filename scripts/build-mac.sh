#!/usr/bin/env bash
# ============================================================================
# build-mac.sh — Genera DMG arm64 e x64 per Anonimator
#
# Uso: bash scripts/build-mac.sh
#
# Strategia:
#   1. Una sola build vite (out/)
#   2. arm64: installa binari sharp arm64 → electron-builder --arm64
#   3. x64:   installa binari sharp x64  → electron-builder --x64
#   4. Fallback hdiutil su Desktop se electron-builder fallisce (es. iCloud Drive)
#   5. Ripristina binari sharp nativi (arm64, macchina di build)
#
# Nota: universal binary con sharp non è supportato (issue lovell/sharp#3622):
#   i .dylib libvips sono arch-specific e non mergeable con lipo.
#   Si distribuiscono due DMG separati: uno per Apple Silicon, uno per Intel.
# ============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/package.json').version")
PRODUCT="Anonimator"
CONFIG="$ROOT/electron-builder.config.js"
DIST="$ROOT/dist"
DESKTOP="$HOME/Desktop"

# Legge versioni sharp correnti (installate per la macchina di build, arm64)
SHARP_ARM64_VERSION=$(node -p "require('$ROOT/node_modules/@img/sharp-darwin-arm64/package.json').version" 2>/dev/null || echo "0.34.5")
SHARP_LIBVIPS_ARM64_VERSION=$(node -p "require('$ROOT/node_modules/@img/sharp-libvips-darwin-arm64/package.json').version" 2>/dev/null || echo "1.2.4")
SHARP_X64_VERSION=$(node -p "require('$ROOT/node_modules/@img/sharp-darwin-x64/package.json').version" 2>/dev/null || echo "0.34.5")
SHARP_LIBVIPS_X64_VERSION=$(node -p "require('$ROOT/node_modules/@img/sharp-libvips-darwin-x64/package.json').version" 2>/dev/null || echo "1.2.4")

echo "============================================================"
echo "  Anonimator v$VERSION — Build macOS arm64 + x64"
echo "============================================================"
echo "  sharp arm64:  @img/sharp-darwin-arm64@$SHARP_ARM64_VERSION"
echo "  sharp x64:    @img/sharp-darwin-x64@$SHARP_X64_VERSION"
echo "============================================================"

cd "$ROOT"

# ── Fase 1: Build codice (una sola volta) ──────────────────────────────────
echo ""
echo "[1/5] Build electron-vite..."
npx electron-vite build

# ── Fase 2: arm64 DMG ──────────────────────────────────────────────────────
echo ""
echo "[2/5] Installazione binari sharp arm64..."
npm install \
  "@img/sharp-darwin-arm64@$SHARP_ARM64_VERSION" \
  "@img/sharp-libvips-darwin-arm64@$SHARP_LIBVIPS_ARM64_VERSION" \
  --force --no-save 2>/dev/null

echo ""
echo "[3/5] Packaging arm64 DMG..."
ARM64_OK=0
if npx electron-builder --mac --arm64 --config "$CONFIG" 2>&1; then
  ARM64_OK=1
  echo "[arm64] DMG creato in dist/"
else
  echo "[arm64] electron-builder fallito (iCloud Drive?), fallback hdiutil su Desktop..."
  APP_ARM64="$DIST/mac-arm64/$PRODUCT.app"
  DMG_ARM64="$DESKTOP/${PRODUCT}-${VERSION}-arm64.dmg"
  if [ -d "$APP_ARM64" ]; then
    hdiutil create \
      -volname "$PRODUCT" \
      -srcfolder "$APP_ARM64" \
      -ov -format UDZO \
      "$DMG_ARM64" && ARM64_OK=1
    echo "[arm64] DMG creato: $DMG_ARM64"
  else
    echo "[arm64] ERRORE: app bundle non trovato in $APP_ARM64"
  fi
fi

# ── Fase 3: x64 DMG ────────────────────────────────────────────────────────
echo ""
echo "[4/5] Installazione binari sharp x64..."
npm install \
  "@img/sharp-darwin-x64@$SHARP_X64_VERSION" \
  "@img/sharp-libvips-darwin-x64@$SHARP_LIBVIPS_X64_VERSION" \
  --force --no-save 2>/dev/null

echo ""
echo "[5/5] Packaging x64 DMG..."
X64_OK=0
if npx electron-builder --mac --x64 --config "$CONFIG" 2>&1; then
  X64_OK=1
  echo "[x64] DMG creato in dist/"
else
  echo "[x64] electron-builder fallito (iCloud Drive?), fallback hdiutil su Desktop..."
  APP_X64="$DIST/mac/$PRODUCT.app"
  DMG_X64="$DESKTOP/${PRODUCT}-${VERSION}-x64.dmg"
  if [ -d "$APP_X64" ]; then
    hdiutil create \
      -volname "$PRODUCT" \
      -srcfolder "$APP_X64" \
      -ov -format UDZO \
      "$DMG_X64" && X64_OK=1
    echo "[x64] DMG creato: $DMG_X64"
  else
    echo "[x64] ERRORE: app bundle non trovato in $APP_X64"
  fi
fi

# ── Ripristino binari arm64 (macchina di build) ────────────────────────────
echo ""
echo "[cleanup] Ripristino binari sharp arm64 (macchina di build)..."
npm install \
  "@img/sharp-darwin-arm64@$SHARP_ARM64_VERSION" \
  "@img/sharp-libvips-darwin-arm64@$SHARP_LIBVIPS_ARM64_VERSION" \
  --force --no-save 2>/dev/null

# ── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Riepilogo build Anonimator v$VERSION"
echo "============================================================"

if [ $ARM64_OK -eq 1 ]; then
  ARM64_DMG="$DIST/${PRODUCT}-${VERSION}-arm64.dmg"
  [ ! -f "$ARM64_DMG" ] && ARM64_DMG="$DESKTOP/${PRODUCT}-${VERSION}-arm64.dmg"
  echo "  ✓ arm64: $ARM64_DMG"
else
  echo "  ✗ arm64: FALLITO"
fi

if [ $X64_OK -eq 1 ]; then
  X64_DMG="$DIST/${PRODUCT}-${VERSION}-x64.dmg"
  [ ! -f "$X64_DMG" ] && X64_DMG="$DESKTOP/${PRODUCT}-${VERSION}-x64.dmg"
  echo "  ✓ x64:   $X64_DMG"
else
  echo "  ✗ x64:   FALLITO"
fi

echo "============================================================"

# Ritorna errore se almeno una build è fallita
[ $ARM64_OK -eq 1 ] && [ $X64_OK -eq 1 ] && exit 0 || exit 1
