#!/usr/bin/env bash
# Usage: OPENROUTER_API_KEY=... scripts/demo/record-demo.sh   → docs/assets/demo.gif
set -euo pipefail
: "${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY (free models need no credit)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
cd ~ && rm -rf /tmp/babelgate-demo
cp -R "$ROOT/scripts/gates/fixtures/edit-task" /tmp/babelgate-demo
vhs "$HERE/demo.tape"
pkill -f "babelgate --preset" || true
mkdir -p "$ROOT/docs/assets" && mv /tmp/babelgate-demo.gif "$ROOT/docs/assets/demo.gif"
