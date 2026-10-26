Verify every write with git diff before committing. Use ./scripts/check.sh quick while iterating and the
default check before pushing. If a contract, fixture or snapshot test fails, stop and report (STOP: line);
don't change fixtures, snapshots, or timeout/retry defaults on your own, and never run `vitest -u`. Adapters
convert only between their own provider and canonical: never import one adapter from another, never
special-case a provider pair. For any change a client can see (wire format, errors, streaming, routes), put
one real request and response (keys redacted) in the PR description. No network in `npm test`; mock new
upstream behaviour in tests/mocks/upstreams.ts. Never log prompt bodies, completions or API keys. Record any
file outside the task's Files block in docs/decisions.md.
