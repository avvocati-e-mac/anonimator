#!/usr/bin/env bash
# download-models.sh — scarica il modello NER ONNX e il file tessdata per OCR
# Eseguire una volta dopo `npm install`:  bash scripts/download-models.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$REPO_ROOT/resources/models/italian-ner-xxl-v2/onnx"
TESSDATA_DIR="$REPO_ROOT/resources/tessdata"

HF_REPO="Laibniz/italian-ner-pii-browser-distilbert"
HF_BASE="https://huggingface.co/${HF_REPO}/resolve/main"

TESS_URL="https://github.com/tesseract-ocr/tessdata/raw/main/ita.traineddata"

echo "==> Creazione cartelle..."
mkdir -p "$MODELS_DIR"
mkdir -p "$TESSDATA_DIR"

# --- Modello NER ---
MODEL_FILE="$MODELS_DIR/model.onnx"
if [ -f "$MODEL_FILE" ]; then
  echo "  Modello NER gia' presente, skip."
else
  echo "==> Download modello NER ONNX (~65 MB)..."
  curl -L --progress-bar \
    "${HF_BASE}/onnx/model.onnx" \
    -o "$MODEL_FILE"
  echo "  Modello NER salvato in: $MODEL_FILE"
fi

# --- tokenizer.json ---
TOKENIZER_FILE="$REPO_ROOT/resources/models/italian-ner-xxl-v2/tokenizer.json"
if [ -f "$TOKENIZER_FILE" ]; then
  echo "  tokenizer.json gia' presente, skip."
else
  echo "==> Download tokenizer.json..."
  curl -L --progress-bar \
    "${HF_BASE}/tokenizer.json" \
    -o "$TOKENIZER_FILE"
  echo "  tokenizer.json salvato."
fi

# --- tokenizer_config.json ---
TOK_CFG="$REPO_ROOT/resources/models/italian-ner-xxl-v2/tokenizer_config.json"
if [ -f "$TOK_CFG" ]; then
  echo "  tokenizer_config.json gia' presente, skip."
else
  echo "==> Download tokenizer_config.json..."
  curl -L --progress-bar \
    "${HF_BASE}/tokenizer_config.json" \
    -o "$TOK_CFG"
  echo "  tokenizer_config.json salvato."
fi

# --- config.json ---
CONFIG_FILE="$REPO_ROOT/resources/models/italian-ner-xxl-v2/config.json"
if [ -f "$CONFIG_FILE" ]; then
  echo "  config.json gia' presente, skip."
else
  echo "==> Download config.json..."
  curl -L --progress-bar \
    "${HF_BASE}/config.json" \
    -o "$CONFIG_FILE"
  echo "  config.json salvato."
fi

# --- Tesseract OCR italiano ---
TESS_FILE="$TESSDATA_DIR/ita.traineddata"
if [ -f "$TESS_FILE" ]; then
  echo "  ita.traineddata gia' presente, skip."
else
  echo "==> Download ita.traineddata per Tesseract OCR (~14 MB)..."
  curl -L --progress-bar \
    "$TESS_URL" \
    -o "$TESS_FILE"
  echo "  ita.traineddata salvato in: $TESS_FILE"
fi

echo ""
echo "Setup completato. Ora puoi eseguire: npm start"
