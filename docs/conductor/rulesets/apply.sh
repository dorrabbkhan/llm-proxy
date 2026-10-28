#!/usr/bin/env bash
# OWNER ONLY. Run from your own shell (your gh login, not the app's):
#   bash docs/conductor/rulesets/apply.sh
# 1. main (classic branch protection): keeps the required `check` and
#    `CLAAssistant` checks and adds one Code Owner approval, not by the
#    last pusher, with stale approvals dismissed; no force-push or
#    deletion. Admins (you) are not enforced, so you can still push or
#    merge directly. The babelgate-conductor app cannot.
# 2. v* tags: only repo admins (you) may create, move or delete them.
set -euo pipefail
cd "$(dirname "$0")"
R=repos/dorrabbkhan/babelgate
case "$(gh api user -q .login)" in
  dorrabbkhan) ;;
  *) echo "run this as dorrabbkhan, not through scripts/conductor" >&2; exit 1 ;;
esac
gh api -X PUT "$R/branches/main/protection" --input main-protection.json \
  -q '"main: checks \(.required_status_checks.contexts | join(", ")); code owner review \(.required_pull_request_reviews.require_code_owner_reviews)"'
existing=$(gh api "$R/rulesets" -q '.[] | select(.name == "release tags") | .id')
if [ -n "$existing" ]; then
  gh api -X PUT "$R/rulesets/$existing" --input tags.json -q '"tag ruleset updated: \(.conditions.ref_name.include | join(", "))"'
else
  gh api -X POST "$R/rulesets" --input tags.json -q '"tag ruleset created: \(.conditions.ref_name.include | join(", "))"'
fi
