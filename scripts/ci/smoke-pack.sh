#!/usr/bin/env bash
# Packed-install smoke test: builds, packs, installs the tarball with
# --omit=dev in a clean directory and runs the `babelgate` bin the way
# `npx babelgate` does — NODE_ENV unset, no devDependencies present
# (pino-pretty included). Guards the 1.1.1 fix for the npx start crash
# and the dotenv startup banner.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

TMP="$(mktemp -d)"
OUT_LOG="$TMP/output.log"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  if [ -f "$OUT_LOG" ]; then
    echo "--- captured output ---" >&2
    cat "$OUT_LOG" >&2
  fi
  exit 1
}

npm run --silent build

TARBALL_NAME="$(npm pack --pack-destination "$TMP" | tail -n 1)"
TARBALL="$TMP/$TARBALL_NAME"
[ -f "$TARBALL" ] || fail "npm pack did not produce $TARBALL"

APP="$TMP/app"
mkdir "$APP"
cd "$APP"
npm init -y >/dev/null
if ! env -u NODE_ENV npm install --omit=dev --prefer-offline --no-audit --no-fund \
  "$TARBALL" >"$OUT_LOG" 2>&1; then
  fail "npm install of the packed tarball failed"
fi

BIN="./node_modules/.bin/babelgate"
[ -x "$BIN" ] || fail "$BIN missing after install"

# `babelgate --help` must exit 0, print the usage line and stay free of
# the dotenv banner — this is where the pino-pretty crash showed up.
if ! env -u NODE_ENV "$BIN" --help >"$OUT_LOG" 2>&1; then
  fail "babelgate --help exited non-zero"
fi
grep -q "Usage: babelgate" "$OUT_LOG" || fail "--help printed no usage line"
if grep -q "injected env" "$OUT_LOG"; then
  fail "dotenv banner leaked into --help output"
fi

# A real start against a dead Ollama endpoint: the server must bind, answer
# /health and print the claude-code export line without the dotenv banner.
PORT="$(node -e 'const s = require("net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); })')"
env -u NODE_ENV OLLAMA_API_BASE_URL=http://127.0.0.1:9 \
  "$BIN" --preset claude-code --target ollama --model smoke --port "$PORT" \
  >"$OUT_LOG" 2>&1 &
SERVER_PID=$!

healthy=""
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.2
done
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

[ -n "$healthy" ] || fail "server did not answer /health within 10s"
grep -q "export ANTHROPIC_BASE_URL=http://localhost:$PORT" "$OUT_LOG" ||
  fail "missing ANTHROPIC_BASE_URL export line"
if grep -q "injected env" "$OUT_LOG"; then
  fail "dotenv banner leaked into startup output"
fi

echo "SMOKE PASS"
