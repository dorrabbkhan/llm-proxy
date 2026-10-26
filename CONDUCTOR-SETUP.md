# Setting up the conductor (Claude Code + local Devin)

## 1. Install and sign in (once)
- Install Claude Code following the official docs (https://code.claude.com/docs). It needs a Claude
  subscription or an Anthropic API key.
- Confirm the local Devin CLI works non-interactively: `devin --help`. Adjust DEVIN_CMD in
  scripts/conductor/devin.sh if its flags differ.
- `gh auth status` must show your account (the conductor uses gh for PRs and comments).
- Run it all as the dedicated, repo-scoped user/container you set up for unattended Devin runs (not your
  everyday account).
- CI arrives with v1.0.1. Until a GitHub Actions workflow exists, `gh pr checks` reports no checks and the
  "wait for green" steps rely on the local `./scripts/check.sh` run instead.

## 2. Files in the repo
CLAUDE.md (conductor instructions), AGENTS.md (agent rules), .claude/commands/ and .claude/settings.json,
.devin/skills/, scripts/conductor/, scripts/check.sh, scripts/llm-proxy-loop.sh and docs/conductor/.
`.claude/settings.local.json`, `.claude/worktrees/` and `.devin/config.local.json` stay untracked.

## 3. Start it
```bash
cd ~/llm-proxy
tmux new -s conductor          # keeps it running if you close the terminal
claude                         # interactive; then type:  /conduct v1.0.1 1
```
or fully headless for one task: `claude -p "/conduct v1.0.1 1"`.
For a range: `/run-plan v1.0.1 1 5` (pauses at gates; waits for your merges).

## 4. Talking to it
Comment on the PR:
- `conductor: fix the Anthropic error shape; keep the existing fixtures unchanged`
- `conductor: rerun review`
- `conductor: continue` (after you answered an "Owner decision needed" comment)
- `conductor: hold` / `conductor: next`
In the tmux window, run `/inbox` (or let /run-plan poll it). Watch the sticky "Conductor status" comment on
each PR for the verdict, CI state and what needs your eyes.

## 5. What stays yours
Merging (or enabling auto-merge), Code Owner approvals, owner gates (fixtures, snapshots, licence, CLA,
publishing), sign-off lines in decisions.md, live-suite runs that spend paid API credit, npm/GHCR
publishing, and release tags. The permission file denies these to the conductor.
