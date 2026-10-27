## Summary

<!-- What and why. If this implements a plan task, name it (e.g. "v1.0.1 task 8"). -->

## Checklist

- [ ] `./scripts/check.sh quick` passes while iterating
- [ ] `./scripts/check.sh` (full gate) run once before pushing — all green
- [ ] Tests added/updated in the same PR (adapter/service changes are test-first)
- [ ] No changes under `tests/fixtures/` or `tests/contracts/__snapshots__/` (if any, the owner approved them)
- [ ] No prompt bodies, completions or API keys in logs, errors, tests or this PR

## Files outside the plan's Files block

<!-- Every file changed that the task plan didn't name, and why. Write "none" if all files were listed. Also record them in docs/decisions.md. -->

## Notes for reviewers

<!-- Ambiguities resolved, follow-ups noticed, anything the reviewer should look at first. -->
