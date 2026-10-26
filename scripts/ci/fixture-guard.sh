#!/usr/bin/env bash
# Fails if existing fixtures or contract snapshots were modified or deleted
# since BASE (default: merge-base with origin/main). New files are allowed.
# ALLOW_FIXTURE_CHANGE=1 skips the guard — the human sets it, never an agent.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "${ALLOW_FIXTURE_CHANGE:-}" = "1" ]; then
  echo "fixture guard: skipped (ALLOW_FIXTURE_CHANGE=1)"
  exit 0
fi

base="${BASE:-$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)}"
changed="$(git diff --name-only --diff-filter=MDR "$base" -- tests/fixtures tests/contracts/__snapshots__)"
if [ -n "$changed" ]; then
  echo "fixture guard: these oracle files changed since $base:" >&2
  echo "$changed" >&2
  echo "Fixtures are the oracle; only the owner may change them (AGENTS.md rule 1)." >&2
  exit 1
fi
echo "fixture guard: ok"
