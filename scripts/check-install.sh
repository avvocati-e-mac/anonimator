#!/usr/bin/env bash
# =============================================================================
# check-install.sh — Diagnostica installazione Anonimator
#
# Uso:
#   bash scripts/check-install.sh
# Oppure da remoto (incolla nel Terminale):
#   bash <(curl -s https://raw.githubusercontent.com/avvocati-e-mac/anonimator/master/scripts/check-install.sh)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✅ $*${RESET}"; }
fail() { echo -e "  ${RED}❌ $*${RESET}"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
warn() { echo -e "  ${YELLOW}⚠️  $*${RESET}"; }
hdr()  { echo -e "\n${BOLD}$*${RESET}"; }

FAIL_COUNT=0

# ─── Rileva path app ──────────────────────────────────────────────────────────
hdr "=== Anonimator — Diagnostica installazione ==="
echo ""

APP_PATH=""
DEFAULT_PATH="/Applications/Anonimator.app"

if [ -d "$DEFAULT_PATH" ]; then
  APP_PATH="$DEFAULT_PATH"
else
  echo "App non trovata in /Applications/Anonimator.app"
  echo -n "Inserisci il path dell'app (es. ~/Desktop/Anonimator.app): "
  read -r CUSTOM_PATH
  CUSTOM_PATH="${CUSTOM_PATH/#\~/$HOME}"
  if [ -d "$CUSTOM_PATH" ]; then
    APP_PATH="$CUSTOM_PATH"
  else
    fail "App non trovata in: $CUSTOM_PATH"
    echo ""
    echo "Impossibile continuare senza trovare l'app."
    exit 1
  fi
fi

ok "App trovata: $APP_PATH"

# ─── Versione app ─────────────────────────────────────────────────────────────
hdr "── Versione"

PLIST="$APP_PATH/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$PLIST" 2>/dev/null || echo "n/d")
  ok "Versione: $VERSION"
else
  fail "Info.plist non trovato"
fi

# ─── Piattaforma ──────────────────────────────────────────────────────────────
hdr "── Piattaforma"

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
# Normalizza: arm64 su Apple Silicon, x64 su Intel
if [ "$ARCH" = "x86_64" ]; then
  ARCH_NORM="x64"
elif [ "$ARCH" = "arm64" ]; then
  ARCH_NORM="arm64"
else
  ARCH_NORM="$ARCH"
fi

ok "Sistema: $PLATFORM / $ARCH (→ $ARCH_NORM)"

# ─── Modello NER ──────────────────────────────────────────────────────────────
hdr "── Modello NER"

RESOURCES="$APP_PATH/Contents/Resources"
MODEL_DIR="$RESOURCES/resources/models/italian-ner-xxl-v2"
MODEL_FILE="$MODEL_DIR/model_quantized.onnx"
TOKENIZER_FILE="$MODEL_DIR/tokenizer.json"

if [ -f "$MODEL_FILE" ]; then
  SIZE=$(du -sh "$MODEL_FILE" 2>/dev/null | cut -f1)
  ok "model_quantized.onnx presente ($SIZE)"
else
  fail "model_quantized.onnx MANCANTE in: $MODEL_DIR"
fi

if [ -f "$TOKENIZER_FILE" ]; then
  ok "tokenizer.json presente"
else
  fail "tokenizer.json MANCANTE"
fi

# ─── onnxruntime binding ──────────────────────────────────────────────────────
hdr "── onnxruntime-node"

ASAR_UNPACKED="$RESOURCES/app.asar.unpacked/node_modules"
ORT_BINDING="$ASAR_UNPACKED/onnxruntime-node/bin/napi-v3/darwin/$ARCH_NORM/onnxruntime_binding.node"

if [ -f "$ORT_BINDING" ]; then
  ok "onnxruntime_binding.node presente ($ARCH_NORM)"
else
  fail "onnxruntime_binding.node MANCANTE: $ORT_BINDING"
  # Verifica se esiste per l'architettura opposta (errore di build)
  if [ "$ARCH_NORM" = "arm64" ]; then
    OTHER="$ASAR_UNPACKED/onnxruntime-node/bin/napi-v3/darwin/x64/onnxruntime_binding.node"
  else
    OTHER="$ASAR_UNPACKED/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node"
  fi
  if [ -f "$OTHER" ]; then
    warn "Trovato binding per architettura ERRATA ($(basename $(dirname $OTHER))) — installato il DMG sbagliato?"
  fi
fi

# ─── detect-libc ──────────────────────────────────────────────────────────────
hdr "── detect-libc"

DETECT_LIBC_DIR="$ASAR_UNPACKED/detect-libc"
if [ -d "$DETECT_LIBC_DIR" ]; then
  ok "detect-libc presente"
else
  fail "detect-libc MANCANTE in app.asar.unpacked"
fi

# ─── sharp binaries ───────────────────────────────────────────────────────────
hdr "── sharp (binari NER)"

SHARP_DIR="$ASAR_UNPACKED/@img"
if [ -d "$SHARP_DIR" ]; then
  SHARP_FOUND=$(ls "$SHARP_DIR" 2>/dev/null | grep "sharp-darwin" | head -5)
  if [ -n "$SHARP_FOUND" ]; then
    while IFS= read -r dir; do
      ok "@img/$dir"
    done <<< "$SHARP_FOUND"
    # Verifica che sia presente quello giusto per l'arch corrente
    if ls "$SHARP_DIR" 2>/dev/null | grep -q "sharp-darwin-$ARCH_NORM"; then
      ok "Binario sharp per $ARCH_NORM presente"
    else
      fail "Binario sharp per $ARCH_NORM NON trovato — NER potrebbe non funzionare"
    fi
  else
    fail "Nessun binario sharp trovato in $SHARP_DIR"
  fi
else
  fail "Cartella @img non trovata in app.asar.unpacked"
fi

# ─── tessdata (OCR) ───────────────────────────────────────────────────────────
hdr "── Tesseract OCR"

TESSDATA="$RESOURCES/resources/tessdata/ita.traineddata"
if [ -f "$TESSDATA" ]; then
  SIZE=$(du -sh "$TESSDATA" 2>/dev/null | cut -f1)
  ok "ita.traineddata presente ($SIZE)"
else
  warn "ita.traineddata non trovato — OCR su immagini non disponibile"
fi

# ─── Log app ──────────────────────────────────────────────────────────────────
hdr "── Log applicazione (ultime 30 righe)"

LOG_PATH="$HOME/Library/Logs/Anonimator/main.log"
if [ -f "$LOG_PATH" ]; then
  ok "Log trovato: $LOG_PATH"
  echo ""
  echo "  --- ultime 30 righe ---"
  tail -30 "$LOG_PATH" | sed 's/^/  /'
  echo "  --- fine log ---"
  echo ""
  # Evidenzia errori NER
  NER_ERRORS=$(grep -i "ner\|onnx\|error\|warning\|mancante" "$LOG_PATH" 2>/dev/null | tail -10 || true)
  if [ -n "$NER_ERRORS" ]; then
    echo "  Righe rilevanti (NER/error/warning):"
    echo "$NER_ERRORS" | sed 's/^/  /'
    echo ""
  fi
else
  warn "Log non trovato (l'app non è mai stata avviata?): $LOG_PATH"
fi

# ─── Riepilogo finale ─────────────────────────────────────────────────────────
hdr "── Riepilogo"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✅ Installazione OK — tutti i componenti presenti.${RESET}"
else
  echo -e "${RED}${BOLD}❌ Trovati $FAIL_COUNT problemi — copia tutto l'output e invialo allo sviluppatore.${RESET}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Per inviare questa diagnostica: seleziona tutto il testo"
echo "del Terminale (Cmd+A), copialo (Cmd+C) e incollalo in"
echo "un'email o messaggio allo sviluppatore."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
