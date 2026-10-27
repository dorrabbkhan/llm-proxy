# Decisions & deviations log

One entry per decision or per task that deviated from the plan or spec. Newest at the bottom.

## 2026-10-26: roadmap brainstorm

- Audience order: individuals and self-hosting developers (Phases 1–2), then teams (Phase 3), then an
  optional hosted control plane (Phase 4). adnymics is not a pilot or target.
- Flawless experiences: Claude Code on anything; any OpenAI-format app on any backend; one endpoint for
  many providers.
- Roadmap shape: hook first (v1.1 streaming + tools + launch), then gateway (v1.2), then visibility
  (v1.3). Gateway-first and translation-first were rejected (spec §5).
- Licence: Apache-2.0 core with a CLA; team governance in a separate private commercial package on a
  public plugin API; paid tier gated on 3 committed teams.
- Repo visibility: the core stays public (already is); the team package and any hosted control plane are
  private. Announcement waits for v1.1.
- Capacity: part-time, agent-driven; S/M/L sizes as in NeoPhylo.
- Found during exploration, to fix in v1.0.1: the Ollama adapter omits `stream` when the client does, so
  Ollama streams NDJSON while `http-client` expects JSON. Not yet confirmed against a live Ollama.

## 2026-10-26: agent and conductor setup

- Mirrors NeoPhylo: AGENTS.md (agent rules), CLAUDE.md (conductor), CONDUCTOR-SETUP.md,
  `.devin/skills/llm-proxy-{task,review}`, `.claude/commands/{conduct,run-plan,inbox}`,
  `.claude/settings.json`, `scripts/conductor/`, `scripts/llm-proxy-loop.sh`, `docs/conductor/`.
- Adapted to this repo: the oracle is `tests/fixtures/` + `tests/contracts/__snapshots__/`, guarded by
  `scripts/ci/fixture-guard.sh`; added rules on adapter independence, canonical/schema lockstep, no
  network in `npm test`, and never logging prompts or keys. Branches are `v<version>/task-<N>-<name>`.
- `scripts/check.sh` added (quick: fixture guard + typecheck + `vitest --changed`; full: guard,
  typecheck, all tests, build). `npm run typecheck` added to package.json.
- Plan mapping in the skills is by filename pattern (`llm-proxy-<version>-plan`), so new plans need no
  skill edits.
- The conductor's permissions additionally deny `npm publish`, `docker push` and `npm run test:live`
  (spends paid API credit).
- No CI exists until v1.0.1; until then the conductor's "wait for green" falls back to the local
  `./scripts/check.sh`.

## v1.0.1 Task 1: live smoke suite — E1 and E10 confirmed live

- `npm run test:live` run 2026-10-27 against a real Ollama (`ollama version is 0.40.11`,
  `qwen3:0.6b` pulled). The run reached Ollama at `localhost:11434` through the host HTTP proxy
  (`NODE_USE_ENV_PROXY=1`, `no_proxy` cleared) because the agent sandbox cannot bind to host
  localhost directly — no code or config changes for that, it's an artefact of the dev environment.
- Result: 8 tests, **4 failed (chat round trips), 4 passed (model lists)** — the expected pre-fix
  state.
- **E1 confirmed:** `openai`/`anthropic`/`ollama` source → `ollama` chat each failed
  `500 TRANSFORM_ERROR` "Cannot read properties of null (reading 'message')": the adapter omits
  `stream`, Ollama replies with NDJSON, `res.json()` yields `null`, `toCanonicalResponse` crashes.
- **E10 confirmed:** `gemini` source → `ollama` chat failed `502` with upstream
  `404 model 'gemini-pro' not found`: the path's model is ignored and the adapter hard-codes
  `gemini-pro`.
- Model lists pass in every source dialect and `LIVE_OLLAMA_MODEL` (`qwen3:0.6b`) is among the ids.
- Resolved ambiguities (not in the plan): cheap default live models for opt-in paid targets
  (`gpt-4o-mini`, `gemini-2.0-flash`, `claude-3-5-haiku-latest`); OpenAI live requests use
  `max_tokens: 16` (still accepted by gpt-4o-mini and by more OpenAI-compatible gateways than
  `max_completion_tokens`); `useTarget` keeps a pre-set `<TARGET>_API_BASE_URL` so a gateway
  endpoint can be injected via env.

## v1.0.1 Task 2: Ollama `stream: false`, strict 2xx JSON, Gemini model from path

- Live run (`npm run test:live`, 2026-10-27, Ollama 0.40.11, `qwen3:0.6b`, via the host HTTP proxy with
  `NODE_USE_ENV_PROXY=1` and `no_proxy` cleared — same sandbox constraint as Task 1, no code changes for
  it): **8/8 pass** — all four source-format chat round trips and all four model lists against `ollama`.
- **Files outside the Files block:**
  - `src/transformers/adapters/index.test.ts` (new): the task's Files block named no home for the
    `PROVIDER_ROUTES`/`modelFromPath` tests or the per-adapter "request without stream sends no streaming
    flag" tests (openai/anthropic/gemini), so they live beside the code they cover.
  - `tests/live/chat.live.test.ts`: live-run finding the suite exists to catch — `qwen3:0.6b` is a
    thinking model; its `thinking` output consumed the whole 16-token budget (`num_predict`), leaving
    `message.content` empty for the openai/anthropic sources (verified directly: `num_predict` 16/64/128
    → `content: ""`, `done_reason: length`; 256 → `"Yes"`). The suite now passes `max_tokens: 512` via
    `chatCall`'s `extra` **only for `target === 'ollama'`** (free, local). The spec §3.5 `max_tokens ≤ 16`
    cap is scoped to paid-provider calls and is unchanged for paid targets.
- Deviations and notes:
  - `ollama.toCanonicalRequest` now maps `stream: false` → absent (only `stream === true` survives).
    Required for the contract round-trip idempotency check once `fromCanonicalRequest` emits
    `stream: false` by default; canonical treats absent and `false` identically (§3.2 checks `=== true`).
  - `http-client.requestJson` rethrows its own `UpstreamError`s inside the attempt loop so the new
    non-JSON-2xx error (and the retries-exhausted 429/503 error) propagates instead of being rewrapped as
    `Upstream unreachable`; this preserves the message and `upstreamStatus`.
  - `UpstreamResponse` gained `contentType` per Interfaces → Produces.
  - Wire-format evidence: Ollama `/api/chat` defaults `stream` to `true`
    (ollama.com api docs, confirmed live in Task 1's NDJSON failures); Gemini selects streaming by
    endpoint (`:streamGenerateContent`), not a body field.
  - `bodyPreview` on the non-JSON-2xx `UpstreamError` is attached only outside production because
    error-handler logs `err.context` in all environments; whether a non-production preview should
    exist at all is left to the owner (spec §3.1 vs Global Constraints privacy).

## v1.0.1 Task 3: CanonicalError and adapter error functions, with fixtures

- Doc sources for the provider error shapes (spec §3.3 table verified against each), read 2026-10-27:
  - OpenAI: https://developers.openai.com/api/docs/guides/error-codes and
    https://developers.openai.com/api/docs/guides/rate-limits (type/code values), plus
    https://github.com/openai/openai-openapi/blob/master/openapi.yaml (ErrorResponse schema and the
    verbatim `InferenceRateLimited`/`InferenceServiceUnavailable`/404 examples used in the parse fixtures).
  - Anthropic: https://platform.claude.com/docs/en/api/errors (shape, type table, verbatim not_found
    example) and https://platform.claude.com/docs/en/api/rate-limits (verbatim rate_limit example); the
    `model: <id>` not_found message is documented in
    https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/error-codes.md.
  - Gemini: https://ai.google.dev/gemini-api/docs/generate-content/api-errors (gRPC error format,
    status table, verbatim 400 INVALID_ARGUMENT body); the real 429 RESOURCE_EXHAUSTED and 404
    NOT_FOUND bodies are corroborated in Google's own SDK repo googleapis/python-genai issues #1427
    and #2087.
  - Ollama: https://docs.ollama.com/api/errors (shape `{"error": string}` + status semantics,
    verbatim 500 bodies) and https://github.com/ollama/ollama/blob/main/docs/openapi.yaml
    (ErrorResponse schema, verbatim 413 example); the 404 `model '<name>' not found` message format is
    verified in Ollama's own source (server/routes.go).
- Kind → provider type choices where spec §3.3's table names the provider's type vocabulary but not
  the kind (recorded per the standing rule; named mappings unchanged):
  - OpenAI: request_too_large → `invalid_request_error` (OpenAI has no 413-specific documented type);
    unsupported → `invalid_request_error` (client-side capability problem, like real
    `unsupported_parameter` errors); upstream → `api_error`; unavailable → `service_unavailable_error`
    (documented for 503/`server_is_overloaded`); timeout → `api_error`; internal → `api_error`.
  - Gemini: upstream → `INTERNAL` (UNAVAILABLE is reserved for the `unavailable` kind; 502 is a
    server-error class, matching gRPC `INTERNAL` for unexpected server failures).
- Parse-fixture provenance notes: OpenAI docs publish the error schema and per-status type/code/
  message fields rather than complete JSON bodies for most errors; the verbatim spec examples
  (slow_down, server_is_overloaded, project_not_found) plus the community-documented real
  `model_not_found` body were used. For Ollama, docs give the verbatim 500/413 bodies and document
  404/429 semantics; the 429 message in the fixture follows the documented description.
- `toCanonicalError` returns `status` = the canonical status for the derived kind (e.g. upstream 529
  → kind `unavailable`, status 503), matching §3.3's status mapping; Task 4's `toClientError` applies
  the remaining upstream→client policy on top. Messages pass through from the provider body shape and
  the fallback is `Upstream <provider> returned <status>`; `toCanonicalError` never throws.
- `canonical.types.ts` and `canonical.schema.ts` changed together in this commit (CanonicalErrorKind,
  CanonicalError, ProviderAdapter.to/fromCanonicalError, canonicalErrorSchema) as required.
- Note: `openai.adapter.ts` already exceeded the ~400-line file guideline on main (440 lines) before
  this task; the error functions were added to it per the task's Files block rather than split out —
  a split is a good candidate for a follow-up cleanup.
- Owner-approved fixes from the PR #3 review (owner decision 2026-10-27):
  - Anthropic `timeout` kind renders as `timeout_error` (Anthropic's documented 504 type), departing
    from the spec §3.3 table which grouped it under `api_error`; §3.3's provider table was updated in
    the same commit.
  - Gemini `API_KEY_INVALID` in `error.details[]` (`google.rpc.ErrorInfo`) maps to kind
    `authentication` (status 401). Reason: Gemini rejects a bad key with 400, so without this Task 4's
    mapping would tell the client its own key is invalid (D1). Task 4's `toClientError` must map from
    the target adapter's canonical kind, not only the raw status.
  - `docs/superpowers/specs/2026-10-26-llm-proxy-v1.0.1-design.md` (§3.3 provider table) is outside
    the task's Files block; edited here to record the owner decision.

## v1.0.1 Task 4: Error wiring — source middleware, dialect rendering, upstream mapping

- Resolves the open `bodyPreview` question from Task 2 (owner decision 2026-10-27, PR #2):
  `bodyPreview` stays in `err.context` outside production and is carried into the non-production
  response `details` on provider paths (`{ ...dialectBody, details: { bodyPreview } }`), and is
  never written to any log line — the error handler no longer logs `err.context` for
  `UpstreamError` at all. `upstreamBody` is likewise kept as a field (for the §3.3 warn-line
  summary) but removed from `context`, so it can no longer reach `details` or a log line.
- `toClientError` decides the credentials case from the target adapter's canonical kind
  (`authentication`/`permission` → 502 credentials message), not the raw upstream status — per the
  owner decision on PR #3 (option 3b), so a Gemini 400 + `API_KEY_INVALID` reply becomes
  `Upstream gemini rejected the proxy's credentials (400)` with no Gemini-specific branch.
- Upstream 5xx other than 503/529 → client 502 `upstream`, per the spec §3.3 table — this
  intentionally overrides `kindFromStatus(500) → internal` for the upstream path: a 500 from the
  provider is an upstream condition, not a proxy bug.
- Log suppression for auth failures covers statuses other than 401/403: the warn line carries no
  upstream message whenever the client error is `upstream` kind on a sub-500 status, which only
  arises from the credentials rule (e.g. Gemini's 400 `API_KEY_INVALID`). This satisfies the
  owner requirement that the API_KEY_INVALID upstream message reach neither client body nor logs.
- `Retry-After` is passed through whenever the upstream sent it (the table only names 429, but
  the passthrough is applied for any status — it is equally meaningful on 503).
- `proxy.service` only applies `toClientError` to `UpstreamError`s carrying an `upstreamStatus`
  ≥ 400. The non-JSON-2xx error carries upstreamStatus 200 and keeps its own message; timeouts and
  transport failures carry no upstreamStatus and keep their unchanged 504/502 rendering.
- `/v1beta/models/:generateContent` (empty model from `modelFromPath`) now returns a clean
  `invalid_request` 400 before any upstream call — the optional item from the PR #2 review.
  `modelFromPath` returning `undefined` (no `:` in the path, e.g. bare `POST /v1beta/models`) keeps
  the existing fallback to `parsed.data.model`.
- `resolveSource` reads `req.path` (set from the URL, before the body parser) and never throws —
  a broken config leaves `sourceApi` unset and errors keep the generic shape.
- The "Unhandled error" log line no longer serializes `err` wholesale: body-parser errors carry
  the raw request body on `err.body` and echo a fragment of it in `err.message` (prompt text).
  Non-ProxyError errors now log whitelisted fields only (`errType`, message, stack), and
  `entity.*` errors log only `body-parser error: <type>` — pinned by the "malformed request body
  is not echoed into the log" test.
- Test notes: `tests/integration/errors.test.ts` sets `UPSTREAM_RETRIES=0` so 429/503 take the
  last-attempt path immediately without backoff sleeps (retry behaviour itself is covered in
  http-client.test.ts). Log capture spies on the real pino logger methods and serializes the call
  arguments with a circular-safe stringify — pino's own serialization decides nothing here beyond
  the argument object, and the pretty transport runs in a worker thread whose fd writes cannot be
  intercepted in-process.
- Files outside the Files block: `src/middleware/request-logger.ts` (+ test) — pre-existing leak
  since v1.0: pino-http's default serializers logged client credential headers and `?key=` URLs;
  fixed here per owner decision 2026-10-27 (PR #4, option a).

## v1.0.1 Task 5: Streaming refusal and unsupported Gemini methods

- `isSupportedPath` returns `true` for a path that doesn't parse to `<m>:<method>` (no `:` in the
  tail, e.g. bare `POST /v1beta/models`). The spec's refusal rule is scoped to the `<m>:<method>`
  form, and `modelFromPath` already falls back to the body model for such paths — refusing them
  would be a behaviour change the spec doesn't name.
- Ollama-source requests without `stream` stay non-streaming (Task 2's absent → `stream: false`
  mapping is untouched). `stream: false` is accepted from every source; only an explicit `true`
  or the Gemini `:streamGenerateContent` endpoint triggers the 501.
- Files outside the Files block:
  - `src/transformers/adapters/anthropic.adapter.ts` (+ `anthropic.adapter.test.ts`) — required:
    the Anthropic adapter dropped the incoming `stream` field, so `canonical.stream` could never
    be `true` for an Anthropic client and the task's
    `"anthropic stream:true → 501"` test could not pass. Added the same `stream === true`
    passthrough the Ollama adapter uses (absent/false identical in canonical).
  - `src/utils/errors.test.ts` — unit test for the new `NotSupportedError` (501, kind
    `unsupported`).
  - `src/transformers/adapters/index.test.ts` — unit tests for the new `isStreamPath` /
    `isSupportedPath` route functions.
