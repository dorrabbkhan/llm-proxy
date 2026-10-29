# v1.2 Task 5 — conductor notes

- Fallback-eligible, exactly: transport failure; header/connect timeout; upstream 429, 500, 502, 503, 504,
  529. Everything else (incl. 400/401/403/404/413/422, non-JSON 2xx, ValidationError, TransformError) fails
  immediately. Once 2xx stream headers are sent, no fallback.
- `attemptTargets` checks `ctx.signal?.aborted` before anything else on a failure and tries no further target
  (Review Focus 2). Every attempt encodes from the original canonical request via `canonicalForTarget`;
  nothing from one target leaks into the next (Review Focus 3).
- Header names verbatim: `x-babelgate-provider`, `x-babelgate-model`, `x-babelgate-attempts`,
  `x-babelgate-partial: true`. Route log line carries only the spec §3.4 fields — no prompt, completion,
  tool arguments or keys. (Source: plan.)
