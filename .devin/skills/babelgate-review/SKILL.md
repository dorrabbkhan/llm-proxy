---
name: babelgate-review
description: Independently review a babelgate PR (or the open PR for a plan task) before it is merged. Usage - /babelgate-review [plan] <PR number or task number>
---

You are a strict reviewer. You did NOT write this code. Do not modify any files; report only.

The arguments are `[<plan>] <PR number or task number>`. If the last argument is a task number, resolve the task's PR first (`gh pr list --head v<version>/task-<N>-*` or `gh search prs`); if no open PR exists for it, stop and say so.

## Plan selection

Map `<plan>` to a file:

- `<version>` (e.g. `v1.0.1`, `v1.1`) → the file in `docs/superpowers/plans/` whose name contains `babelgate-<version>-plan`.
- A missing `<plan>` means the newest file in `docs/superpowers/plans/` (by date in the filename).

The matching spec is read from the plan's `**Spec:**` line, not hard-coded.

1. Read the resolved plan's Global Constraints, Review Focus, and "### Task <N>:" section, plus the spec sections it references in the spec file named on the plan's `**Spec:**` line.
2. Inspect `gh pr diff <N>` (and `gh pr view <N>` for the branch and body); use `gh pr diff <N> --name-only` for the file list.
3. Run `gh pr checks <N>` — every GitHub check must be green. If any check is pending or failed, that item FAILs; cite the failing check and its log (`gh pr checks <N> --watch` to wait, `gh run view --log` for details).
4. Check each item below and mark it PASS or FAIL, with evidence (file:line or command output):
   - Only files listed in the task's Files block changed (plus `docs/decisions.md`; `package-lock.json` only when the task's Files block lists `package.json`/`package-lock.json` — otherwise a lockfile change FAILs).
   - Nothing under `tests/fixtures/` or `tests/contracts/__snapshots__/` changed, unless the task says so.
   - Every test named in the task exists, with the plan's exact values and assertions.
   - No test was removed, skipped (`.skip`, `.only`, `.todo`), or weakened (assertions removed, exact matches loosened).
   - Public names and signatures match the task's Interfaces block exactly.
   - Wire formats match the spec and the provider's documented API (field names, event names, status codes).
   - Adapters import nothing from other adapters; no code special-cases a provider pair.
   - Any change to `canonical.types.ts` is mirrored in `canonical.schema.ts` and recorded in `docs/decisions.md`.
   - No network access in `npm test`; new upstream behaviour is mocked in msw.
   - No prompt bodies, completions or API keys are logged or included in errors.
   - Unsupported inputs fail with a clear error in the source provider's shape, never a 500 or a silent drop.
5. Check out the PR branch (`gh pr checkout <N>`), run `npm ci` and the full `./scripts/check.sh`, and report the results.
6. End with **APPROVE** or **CHANGES NEEDED**, followed by a numbered list of required fixes. Print the verdict here only. Do not post anything to GitHub (no `gh pr review`, no `gh pr comment`): the session runs as the babelgate-conductor GitHub App (not the owner's account), and the conductor posts the status comment.
