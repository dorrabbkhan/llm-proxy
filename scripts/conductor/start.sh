#!/usr/bin/env bash
# Usage: start.sh [claude args...]
# Starts the conductor (Claude Code) as the babelgate-conductor GitHub App,
# so every gh call, push and comment it or its Devin sessions make is the
# bot's, never the owner's. Run it from the repo root, e.g. inside tmux.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/app-env.sh"
exec claude "$@"
