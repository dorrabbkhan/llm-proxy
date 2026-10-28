#!/usr/bin/env bash
# Usage: app-token.sh [--permissions]   (--permissions prints the granted
# permissions as JSON instead of the token, for checking the app's setup)
# Prints a GitHub App installation token for the babelgate-conductor app
# (valid ~1 hour). Config lives outside the repo in
# ~/.config/babelgate-conductor/app.env (APP_CLIENT_ID, INSTALLATION_ID,
# APP_REPO, APP_KEY). Tokens are cached until 5 minutes before expiry when
# the cache dir is writable (Devin's sandbox makes ~/.cache read-only; then
# every call mints a fresh token).
set -euo pipefail
CONF="${BABELGATE_APP_CONF:-$HOME/.config/babelgate-conductor/app.env}"
# shellcheck disable=SC1090
source "$CONF"
OPENSSL=/usr/bin/openssl; [ -x "$OPENSSL" ] || OPENSSL=openssl
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/babelgate-conductor/token.json"
now=$(date +%s)

if [ "${1:-}" != --permissions ] && [ -r "$CACHE" ]; then
  exp=$(jq -r '.expires_epoch // 0' "$CACHE" 2>/dev/null || echo 0)
  if [ "$exp" -gt $((now + 300)) ]; then jq -r .token "$CACHE"; exit 0; fi
fi

b64url() { "$OPENSSL" base64 -A | tr '+/' '-_' | tr -d '='; }
header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now - 60)) $((now + 540)) "$APP_CLIENT_ID" | b64url)
sig=$(printf '%s.%s' "$header" "$payload" | "$OPENSSL" dgst -sha256 -sign "$APP_KEY" -binary | b64url)
jwt="$header.$payload.$sig"

resp=$(curl -fsS -X POST \
  -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" \
  -d "{\"repositories\":[\"$APP_REPO\"]}")
if [ "${1:-}" = --permissions ]; then jq .permissions <<<"$resp"; exit 0; fi
token=$(jq -r .token <<<"$resp")
[ -n "$token" ] && [ "$token" != null ] || { echo "app-token.sh: no token in response" >&2; exit 1; }

expires=$(date -d "$(jq -r .expires_at <<<"$resp")" +%s)
if mkdir -p "$(dirname "$CACHE")" 2>/dev/null; then
  ( umask 077; jq -n --arg t "$token" --argjson e "$expires" '{token:$t, expires_epoch:$e}' >"$CACHE.tmp" \
    && mv "$CACHE.tmp" "$CACHE" ) 2>/dev/null || true
fi
echo "$token"
