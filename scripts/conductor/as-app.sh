#!/usr/bin/env bash
# Usage: as-app.sh <command> [args...]
# Runs one command as the babelgate-conductor GitHub App, e.g.
#   scripts/conductor/as-app.sh gh pr comment 112 --body "..."
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/app-env.sh"
exec "$@"
