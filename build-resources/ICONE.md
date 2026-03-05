# Icone per il build

Prima di eseguire `npm run dist:mac` o `npm run dist:win`, metti qui le icone:

## macOS — icon.icns
- Formato: `.icns`
- Risoluzione consigliata: 1024×1024 px (electron-builder scala automaticamente)
- Come generarla da un PNG 1024×1024:
  ```bash
  # Richiede Xcode command line tools
  mkdir icon.iconset
  sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
  sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
  sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
  sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
  sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
  sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
  sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
  sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
  sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
  cp icon.png            icon.iconset/icon_512x512@2x.png
  iconutil -c icns icon.iconset -o icon.icns
  ```

## Windows — icon.ico
- Formato: `.ico` multi-risoluzione (256, 128, 64, 48, 32, 16 px)
- Come generarla da un PNG 256×256 (richiede ImageMagick):
  ```bash
  magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
  ```
- Alternativa online: https://convertio.co/png-ico/

## Nota
Se le icone mancano, electron-builder userà l'icona Electron di default.
Il build funzionerà comunque — le icone sono opzionali.
