---
name: babelgate-task
description: Implement one numbered task from a babelgate plan, test-first, on its own branch. Usage - /babelgate-task [plan] <task number>
---

You are implementing exactly ONE task from a plan file. The arguments are `[<plan>] <task number>`. If no task number was given, ask for one and stop.

## Plan selection

Map `<plan>` to a file:

- `<version>` (e.g. `v1.0.1`, `v1.1`) → the file in `docs/superpowers/plans/` whose name contains `babelgate-<version>-plan`.
- A missing `<plan>` (only a task number was given) means the newest file in `docs/superpowers/plans/` (by date in the filename).
- If no file matches, stop and say so.

The matching spec is read from the plan's `**Spec:**` line, not hard-coded.

## Procedure

1. Run `git status`. If the working tree is not clean, stop and tell the user.
2. Run `git checkout main && git pull`, then create a branch named `v<version>/task-<N>-<short-name>`.
3. Read, in this order:
   - `AGENTS.md`
   - the plan's "Global Constraints" and "Review Focus" sections
   - the full "### Task <N>:" section
   - every spec section (§) that the task references, in the spec file named on the plan's `**Spec:**` line
4. Check the task's **Interfaces → Consumes** list against the code on main. If anything is missing or has a different name or signature, stop and report. Do not create stand-ins.
5. Run `npm ci` if `node_modules/` is missing or `package-lock.json` changed.
6. Write the failing tests exactly as the task lists them, using the plan's values.
7. Run them and confirm they fail for the expected reason. Show the output.
8. Implement the minimum code needed, using the exact names and signatures from **Interfaces → Produces**.
9. Iterate with `./scripts/check.sh quick`. Once implementation is complete, run the full `./scripts/check.sh` once before pushing. Fix until everything is green.
   9a. If the task changes behaviour a client can see (wire format, errors, streaming, routes), exercise it once with a real HTTP request against `npm run dev` and an msw- or local-Ollama-backed upstream, and paste the request and response (keys redacted) into the PR description.
   9b. Compare `git diff --name-only main` with the task's Files block. For every file outside it, add a "Files outside the Files block" line to this task's entry in docs/decisions.md, saying why each was needed. Include it in the same commit.
10. Commit with the message the task specifies, push the branch, and open a PR with `gh pr create` — the PR body is the final summary headings below.
11. Start `scripts/babelgate-loop.sh watch` so the check watch runs in the background. Do not run `/babelgate-review` on your own PR and do not post reviews or comments on it: the conductor starts an independent review in a fresh session. Block on `scripts/babelgate-loop.sh await` only before writing the final summary. Fix failures by pushing to the same branch.
12. Finish by reporting the PR URL and the check results, plus the summary under these headings: Task; Spec sections implemented; Tests added; Ambiguities I resolved (or "None"); Follow-ups noticed.

## Rules

- Plan and spec values are authoritative. If a contract or fixture test fails, the adapter is wrong. Re-read the spec and the provider's documented wire format; never change the expected values.
- Never edit anything under `tests/fixtures/` or `tests/contracts/__snapshots__/` unless the task says so, and never run `vitest -u`.
- Never skip, delete or loosen a test (`.skip`, `.only`, `.todo`, widened `toMatchObject`, removed assertions).
- Adapters convert only between their own provider and canonical; no provider-pair special cases.
- Do not start work that belongs to any other task. List it under "Follow-ups noticed" instead.
- If the same failure survives 3 different fix attempts, stop and report what you tried.
- Do not add dependencies beyond the plan's Tech Stack without asking first.
