# Decisions & deviations log

One entry per decision or per task that deviated from the plan or spec. Newest at the bottom.

> Renamed llm-proxy → babelgate in v1.1; older entries keep the old name.

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

## v1.0.1 follow-up: live default model `qwen2.5:0.5b`

- Owner decision 2026-10-27 (PR #5 comment, "option 2"): the live suite's default Ollama model
  changes from `qwen3:0.6b` (D5) to `qwen2.5:0.5b`, a small non-thinking model. `qwen3:0.6b` stays
  available opt-in via `LIVE_OLLAMA_MODEL`.
- Reason: `qwen3:0.6b` is a thinking model; it sometimes spends the whole token budget on
  `thinking`, leaving `content` empty and making the `'openai' → 'ollama' chat round trip` live
  test intermittently red — confirmed in the PR #5 review (1 failure in 3 runs). Task 2's
  `max_tokens: 512` for Ollama targets only reduced, not eliminated, the flake.
- Change surface: `tests/live/live.helpers.ts` default; the same default named in the v1.0.1 spec
  (§1.3, §3.5, §3.7, D5 row) and plan (header, Task 1 interfaces, Tasks 7 and 9) so later tasks
  pull the new model.
- Follow-up for v1.1: the proxy currently drops the `thinking` field from Ollama responses;
  surfacing it (e.g. as reasoning content) is a v1.1 item, not fixed here.

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

## v1.0.1 Task 7: CI workflows — Ollama model cache outside the workspace

- Deviations from the plan's literal Step 2 (`.github/workflows/live.yml`):
  - The model cache lives at `/home/runner/.ollama-models` (the ubuntu-latest runner's home)
    bind-mounted into the `ollama/ollama` service as `/root/.ollama` — not `~/.ollama` and not
    inside `github.workspace`. Inside the workspace, `actions/checkout` could clean or replace
    the directory the running service is bound to. The `actions/cache` `path:` is the same
    literal path. Docker creates the host dir as root when the service starts, so a
    `sudo mkdir -p` + `sudo chown -R "$USER"` step runs before the cache step (the restore runs
    as `runner`), and an `if: always()` step at the end re-chowns so the post-job cache save
    can read the root-owned files the pull wrote. Restoring after service start is safe:
    Ollama reads model files at request time from the same bind-mounted directory.
  - Added a "Wait for Ollama" readiness step (60 s timeout, `curl /api/tags` every 2 s) before
    `docker exec ... ollama pull`; the service needs a moment to start listening.
  - `gh workflow run live.yml --ref <branch>` returned 404 before merge: GitHub only dispatches
    workflows that exist on the default branch, so the owner triggers the first live run after
    this PR merges.

## v1.0.1 Task 8: Licence, CLA and contributor docs

- `contributor-assistant/github-action` pinned to `v2.6.1`, the latest release.
  The upstream repository was archived on 2026-03-23 (read-only; releases remain
  functional) — noted for the owner alongside decision D2.
- `cla-signatures` branch must pre-exist: the action stores signatures through
  `repos.createOrUpdateFileContents`, and an empirical probe against the API
  confirmed that endpoint returns 404 `Branch <name> not found` when the branch
  is missing (it cannot create branches). Creating the branch is listed as an
  owner action in the PR — per the action's README, the branch must exist but
  must NOT contain `signatures/cla.json` (the action creates the file itself).
- The `pull_request_target` workflow has no `actions/checkout` step and sets
  explicit minimal permissions; only `secrets.GITHUB_TOKEN` is used.
- Inside the moved "Adding a provider" section in CONTRIBUTING.md, the
  `ProviderAdapter` method list was extended with `toCanonicalError` /
  `fromCanonicalError` (added in Task 3) so the moved text matches the current
  interface. The section is otherwise verbatim from README.md.
- Files outside the Files block:
  - `README.md` — replaced the "Adding a provider" section with a link to
    `CONTRIBUTING.md#adding-a-provider`, as the task requires the section to
    move. No other README changes (Task 9 owns the rest).
- Owner decisions on PR #9 (2026-10-27):
  - The CLA legal text is approved by the owner; the `# DRAFT — requires owner
    review` marker was removed, so `CLA.md` is final.
  - The owner email (`dorrabbk@gmail.com`) stays in `CLA.md` as the Project
    Owner contact.
  - `contributor-assistant/github-action` is pinned by commit SHA
    (`ca4a40a7d1004f18d9960b404b97e5f30a505a08`, tag `v2.6.1`) because the
    upstream repository was archived on 2026-03-23.
  - The `cla-signatures` branch was created from main `fc0be60` on the owner's
    request (the action requires the branch to pre-exist).

## v1.0.1 Task 9: README, CHANGELOG, version 1.0.1, roadmap status

- Files outside the Files block: `package-lock.json` was **regenerated**
  (`npm install --package-lock-only --ignore-scripts`), going beyond the
  Files block's "version field only" — the lockfile on main was stale
  against `package.json` (root still `ISC`, provider SDKs under
  `dependencies`, lingering `@types/uuid`/`yaml` entries, no `engines`).
  The regeneration only moved `dev` flags, removed those stale entries
  and synced root license/engines/version — **no resolved version
  of any package changed** (verified in the diff). `npm ci` afterwards
  installs cleanly (295 packages).
- README quick-start verified verbatim 2026-10-27 against a real Ollama
  (`qwen2.5:0.5b` already pulled): OpenAI-format curl without `stream` →
  200 `chat.completion`. Run through the host HTTP proxy
  (`NODE_USE_ENV_PROXY=1`, `no_proxy` cleared) because the agent sandbox
  cannot reach host localhost directly — same constraint as Tasks 1–2,
  no code or doc changes for it; request/response pasted in the PR.
- README claims checked against the code, not copied from the plan: the
  error mapping table comes from `src/services/upstream-errors.ts`, the
  four auth styles from `src/middleware/require-api-key.ts`, the live
  env vars from `tests/live/live.helpers.ts`, and the test count is now
  "~700" (709 on main) — the roadmap status line's "315 tests" was
  updated inside that line as part of the v1.0.1 status change.
- CHANGELOG `[1.0.1]` links to the releases/tag URL
  (`.../releases/tag/v1.0.1`) — no prior tag exists to compare from; the
  owner creates the tag after merge and adjusts the `2026-10-27` header
  date if the merge is later.
- Owner decision (2026-10-27, PR #5) applied to docs: an Ollama-format
  request that omits `stream` is answered non-streaming — stated in
  README's Known limitations and CHANGELOG's Changed, with "send
  `"stream": false` explicitly" and the 501-until-v1.1 note.
- Fix round 1 (PR #10 review): `CONTRIBUTING.md` edited to remove the
  stale "still in owner review" CLA wording — outside this task's Files
  block, recorded here.

## v1.0.1 summary — deviations recorded across the version

One line each; details in the task entries above. Task PRs: 1→#1, 2→#2,
3→#3, 4→#4, 5→#5, 6→#6, follow-up→#7, 7→#8, 8→#9, 9→this PR.

- Task 1 (PR #1): chose cheap default live models for opt-in paid targets
  (`gpt-4o-mini`, `gemini-2.0-flash`, `claude-3-5-haiku-latest`), OpenAI
  live `max_tokens: 16`, `useTarget` keeps a pre-set `<TARGET>_API_BASE_URL`.
- Task 2 (PR #2): files outside the Files block (`adapters/index.test.ts`,
  `chat.live.test.ts` Ollama `max_tokens: 512`); Ollama adapter maps
  `stream: false` → absent for contract idempotency; `http-client`
  rethrows its own `UpstreamError`s; `bodyPreview` kept non-production
  only (left for the owner, resolved in Task 4).
- Task 3 (PR #3): kind→provider-type picks where §3.3 didn't name the kind
  (OpenAI `invalid_request_error`/`api_error`/`service_unavailable_error`,
  Gemini `INTERNAL`); owner-approved changes: Anthropic `timeout_error`,
  Gemini `API_KEY_INVALID` → `authentication`, spec §3.3 table edited in
  the same commit; `openai.adapter.ts` already over ~400 lines.
- Task 4 (PR #4): `upstreamBody` removed from `err.context`;
  `bodyPreview` deliberately stays in `err.context` outside production
  and is surfaced in non-production `details`, but is never logged
  (owner decision, PR #2); `toClientError` keys on the parsed kind, not raw status; all
  upstream 5xx except 503/529 → 502; `Retry-After` passes through on any
  status; `resolveSource` never throws; unhandled-error log whitelists
  fields; `request-logger` credential redaction (outside the Files block).
- Task 5 (PR #5): `isSupportedPath` returns true for unparseable paths;
  Anthropic adapter gained `stream === true` passthrough. Files outside
  the Files block: `src/transformers/adapters/anthropic.adapter.ts` plus
  three modified test files (`anthropic.adapter.test.ts`,
  `src/utils/errors.test.ts`, `src/transformers/adapters/index.test.ts`).
- Task 6 (PR #6): no deviations recorded.
- Follow-up (PR #7): live default Ollama model `qwen3:0.6b` →
  `qwen2.5:0.5b` per owner decision (thinking flake); spec and plan
  updated to match; Ollama `thinking` drop noted as a v1.1 follow-up.
- Task 7 (PR #8): live.yml model cache moved to `/home/runner/.ollama-models`
  bind-mounted into the service (workspace caching was unsafe); added a
  wait-for-Ollama step; first live run is owner-triggered after merge
  because `workflow_dispatch` only exists on the default branch.
- Task 8 (PR #9): CLA action pinned by SHA `v2.6.1` (upstream repo
  archived); `cla-signatures` branch must pre-exist (owner created it);
  CONTRIBUTING's adapter method list extended with the Task 3 error
  functions; README's "Adding a provider" replaced by a link (outside
  the Files block); CLA text owner-approved and finalized.
- Task 9 (this PR): `package-lock.json` regenerated beyond "version field
  only" (see this task's entry); roadmap status line's stale "315 tests"
  corrected to ~700 inside the line; CHANGELOG links to the tag URL
  (no prior tag to compare from).

## v1.1 Task 1: rename to babelgate

- `fromCanonicalModelList`'s `owned_by` fallback is now `"babelgate"` (was
  `"llm-proxy"`) — a client-visible wire change on the OpenAI model list.
- Agent tooling deliberately keeps the llm-proxy name for v1.1 (plan Task 1
  exclusion list): `.devin/skills/**`, `.claude/**`, `scripts/llm-proxy-loop.sh`,
  `scripts/conductor/**`, `CLAUDE.md`, `AGENTS.md`, `CONDUCTOR-SETUP.md`, and
  past specs/plans/decisions.
- Files outside the Files block: `CHANGELOG.md` (release/compare URLs moved to
  the new repo name — required by the task's `git grep llm-proxy` check);
  `src/transformers/adapters/openai.adapter.test.ts` (the new `owned_by` test,
  per Step 1).
- `docs/roadmap.md`'s link to the roadmap design spec was reworded to a
  date-based pointer: the spec file keeps its `llm-proxy` name (past spec files
  are excluded from the rename), so the literal filename could not stay without
  failing the task's grep check.

## v1.1 Task 2: canonical stream events and stream utilities

- Canonical changes (spec §3.1), all mirrored in `canonical.schema.ts`:
  `CanonicalStreamEvent` replaces `CanonicalStreamChunk`/`CanonicalDelta`
  (both had no users; `canonicalStreamChunkSchema` removed with them);
  `CanonicalRequest.toolChoice`, `CanonicalConfig.contextWindow`,
  `CanonicalMessage.isError`; `StreamDecoder`, `StreamEncoder`,
  `StreamEncoderContext`, `IdGenerator`; `ProviderAdapter` gains
  `createStreamDecoder`/`createStreamEncoder` and `toCanonicalResponse`
  gains an optional `ids?: IdGenerator` (existing two-arg implementations
  still satisfy the interface).
- `createStreamDecoder` takes `ids?: IdGenerator` per the plan's Interfaces
  block; spec §3.1's sketch omits it — the plan is authoritative.
- All four adapters stub `createStreamDecoder`/`createStreamEncoder` with
  `NotSupportedError` and the existing 501 message, so `proxy.service`'s
  stream branch (Task 4) keeps returning 501 until Tasks 4–7 land.
- `createSseParser` drops an event with no `data:` field (bare `event:` /
  comment-only blocks) and dispatches a still-buffered event at `end()`;
  `createLineSplitter`/`takeLines` key on "\n" and strip a trailing "\r",
  which also covers `\r\n` split across chunks.
- `parseToolArguments` treats a whitespace-only string like `""` (→ `{}`,
  valid); valid JSON that isn't an object (arrays, scalars) gets the
  `_invalid_arguments` wrapper.
- `reassembleStream` enforces the spec §3.1 rules strictly (sequential
  `tool_call_start` indexes from 0, deltas/ends only on open calls, usage at
  most once, nothing after `message_end`/`error`); violations raise
  `TransformError`, an `error` event raises a `ProxyError` carrying the
  event's status and kind as its code.
- `createIdGenerator` uses a random base64url suffix (`call_<12 chars>`);
  `sequentialIds` stays `call_0`, `call_1`, … for deterministic tests.
- `createUtf8Decoder` flushes on an empty `Uint8Array` (a truncated trailing
  character becomes U+FFFD); decoders call it from `end()`.

## v1.1 Task 3: stream fixture corpus

- `tests/fixtures/streams/` holds raw provider stream bytes plus a `<case>.json`
  (`source`, `date`, `model`, `expectedEvents`, `nonStreaming`) per case.
  `tests/contracts/stream-fixtures.test.ts` validates them; decoding the bytes is
  exercised by the decoder tasks (4–7).
- Sources: Ollama cases recorded live (`npm run record:streams`,
  ollama 0.40.11, `qwen2.5:0.5b`); Anthropic cases verbatim from
  docs.claude.com streaming examples; OpenAI `text` verbatim from the
  API-reference streaming example and `tool_call` from the recorded
  gpt-4o stream in `openai/openai-go`'s `streamaccumulator_test.go`;
  Gemini cases from recorded `streamGenerateContent?alt=sse` exchanges in
  `google/adk-go` httprr traces and a `googleapis/js-genai` test recording
  (Google-published captures — real provider bytes, per spec §4.1's
  "documented examples verbatim, or owner-recorded" fallback).
- Omissions (no documented/recorded provider bytes found; wire-format claims
  without evidence are not allowed):
  - `openai`: `parallel_tool_calls`, `after_tool_result`, `max_tokens`,
    `error` — current docs only show Responses-API streaming for tool calls;
    needs owner-recorded fixtures.
  - `anthropic`: `parallel_tool_calls`, `after_tool_result`, `max_tokens` —
    the streaming docs publish text, tool_use and error examples only.
  - `gemini`: `max_tokens`, `error` — no recorded MAX_TOKENS or in-stream
    `{"error":…}` exchange found in Google's published captures.
  - `ollama`: `error` is recorded, but note it comes from a 404 response
    line — Ollama answers errors as a single `{"error":"…"}` body, and the
    documented in-stream form is the same line shape. No public way found to
    trigger a mid-stream error line.
- Edits to captured bytes, disclosed: the OpenAI `tool_call` capture drops the
  second synthetic `choices:[]` usage chunk the SDK authors added for a
  token-details accumulator test (real streams emit exactly one). The OpenAI
  `text` doc example's literal `: Intermediate chat completion chunks
  omitted.` comment line is kept verbatim (it also exercises comment
  handling); no chunks were invented. The Gemini `tool_call` `.sse` is
  re-serialized `data:` framing around the recording's verbatim JSON payload.
- Conventions the decoder tasks must follow (resolved ambiguities, spec §3.1
  rules leave these open):
  - Generated IDs come from `sequentialIds()` in emission order: when the wire
    has no message ID (Ollama), `message_start.id` draws `call_0` first; tool
    call IDs use the wire `id` when present (OpenAI `call_…`, Anthropic
    `toolu_…`, Ollama `call_…`) and draw `call_0`, `call_1`, … when absent
    (Gemini; the wire `responseId` is used for `message_start.id` there).
  - Empty `content`/argument strings produce no `text_delta`/`tool_call_delta`
    event (e.g. OpenAI's opening `{"role":"assistant","content":""}` chunk).
  - `usage` is emitted once, before `message_end`: Anthropic merges
    `message_start.usage.input_tokens` with `message_delta`'s cumulative
    `output_tokens`; Gemini takes the last chunk's cumulative `usageMetadata`;
    OpenAI takes the single `choices:[]` usage chunk; Ollama the `done:true`
    line's `prompt_eval_count`/`eval_count`.
  - `message_end.finishReason` is canonical: Anthropic `tool_use`, OpenAI
    `tool_calls`, and a Gemini/Ollama stream ending in tool calls all become
    `tool_call`; Ollama `done_reason:"length"` becomes `length`.
- `nonStreaming` twins are embedded only where the current adapters produce an
  equal canonical response on `message`/`finishReason`/`usage`
  (ollama `text` and `after_tool_result` — recorded with `temperature:0`, and
  gemini `text` where the single chunk is itself a complete
  `GenerateContentResponse`). They are `null` for tool cases (tool mapping
  lands in Tasks 8–10) and for ollama `max_tokens` (the non-stream adapter maps
  `done` to `"stop"` and ignores `done_reason:"length"` — follow-up).
- Files outside the Files block: none (the `<case>.nonstreaming.json` twins
  are inside the created `tests/fixtures/streams/` tree, which the Files block
  covers as `<case>.{sse|ndjson}` plus `<case>.json`; the extra twin files are
  recorded provenance for the embedded `nonStreaming` bodies).
