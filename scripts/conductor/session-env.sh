#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json): every Bash command in a Claude
# Code session opened in this repo acts as the babelgate-conductor GitHub
# App, however the session was started (start.sh is no longer required).
# Writes plain absolute `export` lines to $CLAUDE_ENV_FILE, which Claude
# Code sources before each command, so it works whatever the user's shell
# (app-env.sh itself is bash-only). On a machine without the app's config
# it writes nothing and the session stays the user's own.
set -euo pipefail
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
[ -r "${BABELGATE_APP_CONF:-$HOME/.config/babelgate-conductor/app.env}" ] || exit 0
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
env -i HOME="$HOME" PATH=/usr/bin:/bin bash -c 'source "$1/app-env.sh"; env' _ "$here" |
  grep -E '^(GIT_CONFIG_|GIT_AUTHOR_|GIT_COMMITTER_|CONDUCTOR_ACTOR=)' |
  while IFS='=' read -r k v; do printf "export %s='%s'\n" "$k" "$v"; done >>"$CLAUDE_ENV_FILE"
printf 'export PATH=%s:"$PATH"\n' "'$here/bin'" >>"$CLAUDE_ENV_FILE"
