#!/bin/sh
# Project Extractor launcher (macOS/Linux). Add "lan" to allow phones on the same Wi-Fi.
cd "$(dirname "$0")/app" || exit 1
PORT=8765; BIND=127.0.0.1; [ "$1" = "lan" ] && BIND=0.0.0.0
echo "Open http://localhost:$PORT/index.html  (Ctrl+C to stop)"
python3 -m http.server $PORT --bind $BIND
