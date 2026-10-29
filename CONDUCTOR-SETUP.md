# Setting up the conductor (Claude Code + local Devin)

## 1. Install and sign in (once)
- Install Claude Code following the official docs (https://code.claude.com/docs). It needs a Claude
  subscription or an Anthropic API key.
- Confirm the local Devin CLI works non-interactively: `devin --help`. Adjust DEVIN_CMD in
  scripts/conductor/devin.sh if its flags differ.
- `gh auth status` must show your account (the conductor uses gh for PRs and comments).
- Run it all as the dedicated, repo-scoped user/container you set up for unattended Devin runs (not your
  everyday account).
- CI runs on every PR via `.github/workflows/ci.yml` (job `check`); `gh pr checks` reports it. The nightly
  live suite is `.github/workflows/live.yml` (Ollama only, unless provider keys are added as secrets).

## 1b. The conductor's GitHub identity (once)
The conductor and Devin act as a GitHub App, so their PRs, pushes and comments are `babelgate-conductor[bot]`'s,
you can approve them, and only your comments count as commands.
1. github.com/settings/apps/new → name `babelgate-conductor`, homepage the repo URL, webhook off, installable
   only on your account. Repository permissions: Contents, Pull requests, Issues = Read & write; Actions,
   Checks, Commit statuses, Metadata = Read; everything else (notably Administration, Workflows, Secrets) =
   No access. Actions stays read-only because `live.yml` runs with provider API keys.
2. Generate a private key → `~/.config/babelgate-conductor/app.pem` (`chmod 600`). Install the app on this
   repository only.
3. Write `~/.config/babelgate-conductor/app.env`:
   `APP_ID=…`, `APP_CLIENT_ID=…`, `INSTALLATION_ID=…`, `APP_REPO=babelgate`,
   `APP_KEY=$HOME/.config/babelgate-conductor/app.pem`.
4. Check: `scripts/conductor/app-token.sh --permissions` prints exactly the permissions above.
5. Branch rules (owner): `bash docs/conductor/rulesets/apply.sh` from your own shell — `main` keeps its required
   checks and gains a required Code Owner approval (admins may bypass); `v*` tags can be created only by you.
Your own shell keeps using `gh` and git as you. Every Claude Code session opened in this repo acts as the app
(SessionStart hook `scripts/conductor/session-env.sh`), as do processes started through `scripts/conductor/`. The CLA workflow's allowlist (`*[bot]`) already covers the app.

## 2. Files in the repo
CLAUDE.md (conductor instructions), AGENTS.md (agent rules), .claude/commands/ and .claude/settings.json,
.devin/skills/, scripts/conductor/, scripts/check.sh, scripts/babelgate-loop.sh and docs/conductor/.
`.claude/settings.local.json`, `.claude/worktrees/` and `.devin/config.local.json` stay untracked.

## 3. Start it
```bash
cd ~/babelgate
tmux new -s conductor          # keeps it running if you close the terminal
claude                         # acts as the app (SessionStart hook); then type:  /conduct v1.0.1 1
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
