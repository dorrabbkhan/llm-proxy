#!/usr/bin/env bash
# Local replacement for CI. Run from anywhere in the repo.
#
#   ./scripts/check.sh        full local gate: run once before pushing,
#                             same checks the PR workflow runs
#   ./scripts/check.sh quick  iteration gate: fixture guard + typecheck,
#                             tests only for files changed since BASE
#
# BASE overrides the comparison commit (default: merge-base with
# origin/main); ALLOW_FIXTURE_CHANGE=1 skips the fixture guard (human only).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode="${1:-}"
case "$mode" in
  ""|quick) ;;
  *) echo "usage: $0 [quick]" >&2; exit 2 ;;
esac

[ -d node_modules ] || npm ci

if [ "$mode" = "quick" ]; then
  scripts/ci/fixture-guard.sh
  npm run --silent typecheck
  base="${BASE:-$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)}"
  npx vitest run --changed "$base" --passWithNoTests
  printf '\nQUICK CHECKS PASSED (run ./scripts/check.sh before pushing)\n'
  exit 0
fi

scripts/ci/fixture-guard.sh
npm run --silent typecheck
npm test
npm run --silent build
scripts/ci/smoke-pack.sh

printf '\nALL CHECKS PASSED\n'
