Verify every write with git diff before committing. Use ./scripts/check.sh quick while iterating and the
default check before pushing. If a contract, fixture or snapshot test fails, stop and report (STOP: line);
don't change fixtures, snapshots, or timeout/retry defaults on your own, and never run `vitest -u`. Adapters
convert only between their own provider and canonical: never import one adapter from another, never
special-case a provider pair. For any change a client can see (wire format, errors, streaming, routes), put
one real request and response (keys redacted) in the PR description. No network in `npm test`; mock new
upstream behaviour in tests/mocks/upstreams.ts. Never log prompt bodies, completions or API keys. Record any
file outside the task's Files block in docs/decisions.md.
Devin sandbox: `~/.npm` is read-only, so `npm pack`/`npm install` in `scripts/ci/smoke-pack.sh` fail with EROFS; run it with `npm_config_cache=$(mktemp -d)` (that passes). `XDG_RUNTIME_DIR` is read-only and each command runs in its own PID namespace, so a backgrounded `scripts/babelgate-loop.sh watch` may die; if it does, run `gh pr checks <PR> --watch` in the foreground before the final summary.
