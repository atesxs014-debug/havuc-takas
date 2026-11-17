#!/bin/bash
# Mac / Linux: çift tıklayın (Mac'te ilk seferde sağ tık → Aç)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadı. https://nodejs.org adresinden LTS sürümünü kurun, sonra tekrar çalıştırın."
  open https://nodejs.org/tr/download 2>/dev/null || xdg-open https://nodejs.org/tr/download 2>/dev/null
  read -r -p "Kapatmak için Enter'a basın"; exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 22 ]; then
  echo "Node.js sürümünüz eski ($(node -v)). En az 22 gerekli: https://nodejs.org"
  read -r -p "Kapatmak için Enter'a basın"; exit 1
fi
[ -f .env ] || cp .env.example .env
if [ ! -d node_modules ]; then
  echo "İlk kurulum yapılıyor, bu birkaç dakika sürebilir..."
  npm install --omit=dev || { read -r -p "Kurulum başarısız. Enter"; exit 1; }
  npm run seed
fi
( sleep 2; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null ) &
npm start
