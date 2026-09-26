#!/usr/bin/env bash
# Second tab: the frontend dev server. Installs node_modules on first run.
set -euo pipefail
cd "$(dirname "$0")"

[[ -d node_modules ]] || npm install

exec npm run dev
