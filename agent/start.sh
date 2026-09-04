#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run, this downloads Cypress)..."
  npm install
fi
exec node server.js
