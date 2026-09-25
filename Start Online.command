#!/bin/bash
# Runs Lineup Auction on a free public link so friends can join from anywhere.
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:$PATH"

command -v cloudflared >/dev/null || brew install cloudflared
[ -d node_modules ] || npm install

PORT=${PORT:-3000}
LOG=$(mktemp)
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null; rm -f "$LOG"' EXIT

echo "Getting public link..."
for i in $(seq 1 60); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then echo "Couldn't get a public link:"; cat "$LOG"; exit 1; fi

PUBLIC_URL="$URL" PORT=$PORT node server.js
