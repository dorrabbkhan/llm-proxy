#!/usr/bin/env bash
# Agent-loop helper: overlap the independent PR review with CI instead of
# waiting for green first. Usage after `gh pr create`:
#
#   scripts/babelgate-loop.sh watch [pr]   start `gh pr checks --watch` in
#                                       the background, then run the
#                                       /babelgate-review pass while CI runs
#   scripts/babelgate-loop.sh await [pr]   block until the watch finishes;
#                                       call only before the final summary
#   scripts/babelgate-loop.sh status [pr]  print check state once
#
# The PR number defaults to the PR for the current branch. State lives in
# ${XDG_RUNTIME_DIR}/babelgate-loop/pr-<n>.{log,rc,pid}, falling back to
# ${TMPDIR:-/tmp} when XDG_RUNTIME_DIR is unset or not writable.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

cmd="${1:-}"
pr="${2:-}"
if [ -z "$pr" ]; then
  pr="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
case "$cmd" in
  watch|await|status) ;;
  *) echo "usage: $0 {watch|await|status} [pr-number]" >&2; exit 2 ;;
esac
if [ -z "$pr" ]; then
  echo "no PR number given and none found for the current branch" >&2
  exit 1
fi

state_base="${XDG_RUNTIME_DIR:-}"
if [ -z "$state_base" ] || [ ! -w "$state_base" ]; then
  state_base="${TMPDIR:-/tmp}"
fi
state_dir="$state_base/babelgate-loop"
mkdir -p "$state_dir"
log="$state_dir/pr-$pr.log"
rc="$state_dir/pr-$pr.rc"
pidf="$state_dir/pr-$pr.pid"

case "$cmd" in
  watch)
    if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
      echo "watch already running for PR #$pr (pid $(cat "$pidf"))"
      exit 0
    fi
    rm -f "$rc"
    ( gh pr checks "$pr" --watch >"$log" 2>&1; echo $? >"$rc" ) &
    echo $! > "$pidf"
    echo "watching PR #$pr checks in the background (log: $log)"
    ;;
  await)
    while [ ! -f "$rc" ]; do
      if [ -f "$pidf" ] && ! kill -0 "$(cat "$pidf")" 2>/dev/null; then
        echo "watch for PR #$pr died without writing a status" >&2
        exit 2
      fi
      sleep 10
    done
    tail -25 "$log"
    exit "$(cat "$rc")"
    ;;
  status)
    gh pr checks "$pr"
    ;;
esac
