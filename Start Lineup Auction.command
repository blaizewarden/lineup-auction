#!/bin/bash
cd "$(dirname "$0")"
clear
echo "Starting Lineup Auction..."
NODE=node
if ! command -v node >/dev/null 2>&1; then
  if [ ! -x ./.node/bin/node ]; then
    echo "First time only: downloading Node.js (about 45 MB)..."
    ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
    VER=v20.18.0
    mkdir -p .node
    if ! curl -fL --progress-bar "https://nodejs.org/dist/$VER/node-$VER-darwin-$ARCH.tar.gz" | tar -xz -C .node --strip-components=1; then
      rm -rf .node
      echo "Download failed. Check your internet connection and double-click again."
      read -n 1 -s -r -p "Press any key to close."
      exit 1
    fi
  fi
  NODE=./.node/bin/node
fi
"$NODE" server.js
read -n 1 -s -r -p "Stopped. Press any key to close."
