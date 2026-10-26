#!/usr/bin/env bash
# Usage: status-comment.sh <PR> <file-with-markdown-body>
# Creates or updates a single sticky "Conductor status" comment on the PR.
set -euo pipefail
PR="$1"; BODY_FILE="$2"
MARK="<!-- conductor-status -->"
BODY="$MARK"$'\n'"$(cat "$BODY_FILE")"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
ID="$(gh api "repos/$REPO/issues/$PR/comments" --paginate -q ".[] | select(.body | startswith(\"$MARK\")) | .id" | tail -1)"
if [ -n "$ID" ]; then gh api -X PATCH "repos/$REPO/issues/comments/$ID" -f body="$BODY" >/dev/null
else gh pr comment "$PR" --body "$BODY" >/dev/null; fi
echo "status comment updated on PR #$PR"
