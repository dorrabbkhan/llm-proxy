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
  - `ollama`: `error` — per https://docs.ollama.com/api/errors a mid-stream
    error is an NDJSON `{"error":"…"}` line after normal chunks, with the
    HTTP status left at 200; a decoder never sees a 404. The first
    recording was a pre-stream 404 `application/json` body — the
    non-streaming JSON-error path (plan Review Focus #4), not decoder
    input — so the case was removed. Needs an owner recording of a real
    mid-stream error.
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
  - Gemini and Ollama send tool arguments as objects on the wire:
    `argumentsDelta` is `JSON.stringify` of the wire `args`/`arguments`
    object (key order preserved), and `stream-fixtures.test.ts` checks the
    concatenated deltas against the wire bytes.
  - `anthropic/error`'s event list is error-only (no `message_start`):
    the documented example (docs.claude.com 'Error events') shows only the
    error event itself, so decoders emit it as-is.
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

## v1.1 Task 3b: recorded stream fixtures

- Owner-requested follow-up to Task 3: record the missing cases live instead of
  relying on published captures. `scripts/record-streams.ts` now supports all
  four providers (gated on `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`;
  base URLs from `<PROVIDER>_API_BASE_URL`, public defaults otherwise; model
  overrides `RECORD_OPENAI_MODEL`/`RECORD_ANTHROPIC_MODEL`/`RECORD_GEMINI_MODEL`/
  `RECORD_OLLAMA_MODEL`). `RECORD_PROVIDERS` and `RECORD_CASES` filter the run;
  existing files are never overwritten unless `RECORD_OVERWRITE=1`.
- `expectedEvents` are generated programmatically from the recorded bytes by
  `scripts/stream-fixture-decode.ts` (verified: it reproduces every existing
  fixture's expectedEvents exactly). Anything the Task 3 conventions don't
  cover throws and prints `STOP:` instead of guessing.
- Recorded this run (2026-10-27):
  - `ollama/error` — qwen2.5:0.5b, ollama 0.40.11. A real mid-stream error:
    HTTP 200, normal NDJSON chunks, then `{"error":"an error was encountered
    while running the model: unexpected EOF"}` (docs.ollama.com/api/errors
    shape). Trigger: the llama runner was stopped mid-generation
    (`OLLAMA_MIDSTREAM_KILL`, default `docker exec ollama pkill -f
    llama-server`). The wire carries no status/code; the canonical error is
    `internal`/`500` — the same failure returned pre-stream would be an HTTP
    500, so `kindFromStatus(500)` applies.
  - `gemini/max_tokens` — gemini-3.5-flash-lite (`RECORD_GEMINI_MODEL`;
    the script default `gemini-2.5-flash` now returns 404 "no longer
    available to new users" on this API key). `finishReason: MAX_TOKENS`
    mid-stream → canonical `length`. The `nonStreaming` twin matched on
    message/finishReason/usage and is embedded.
- Still omitted (recorded evidence impossible this run):
  - `openai`: `parallel_tool_calls`, `after_tool_result`, `max_tokens`,
    `error` — the key is set but the account has no credit: every case got a
    pre-stream HTTP 429 (`credit_balance_exhausted`), which is the normal
    JSON-error path, not a stream fixture.
  - `anthropic`: `parallel_tool_calls`, `after_tool_result`, `max_tokens` —
    same: pre-stream HTTP 400 (credit balance too low).
  - `gemini/error`, `openai/error` — no deterministic way to make either
    provider send an in-stream `{"error":…}` on a 2xx stream is known; every
    error trigger probed (invalid tool configs, unsupported modalities,
    exhausted quota) returned a pre-stream non-2xx. The script defines no
    `error` case for them; fabricating or splicing bytes is not allowed.
- Provenance note: `message_start`/`tool_call_start` keep the provider's
  response-object IDs verbatim (`chatcmpl-…`, `msg_…`, `responseId`), as the
  existing fixtures do. Only response bodies are recorded — no request
  headers, API keys, org IDs or `request_id`/`x-request-id` values enter the
  files.
- Files outside the Files block: `scripts/record-streams.ts` extended for
  openai/anthropic/gemini (owner-requested follow-up); split for the ~400-line
  rule into `scripts/record-streams-cases.ts` (per-provider endpoints and case
  definitions) and `scripts/stream-fixture-decode.ts` +
  `scripts/stream-fixture-events.ts` (wire bytes → `expectedEvents` /
  `nonStreaming` matching).

## v1.1 Task 3b fix: OLLAMA_MIDSTREAM_KILL is opt-in

- `OLLAMA_MIDSTREAM_KILL` no longer defaults to `docker exec ollama pkill -f
  llama-server`. `npm run record:streams` never kills a process unless the
  variable is explicitly set; without it the ollama `error` case is skipped
  with a log line naming the variable.
- When set, the command is run once, mid-stream (after the first stream lines
  arrive), to induce a real in-stream error. `pkill -f llama-server` stops
  EVERY model runner in the container — set it only against an Ollama
  instance dedicated to recording.
- Ollama fixture `source` now names the server version, matching the other
  recorded fixtures: `recorded: ollama <version>, <model> (via npm run
  record:streams<; note>)`. The script queries `GET /api/version` for it and
  skips ollama entirely when the base URL doesn't answer.

## v1.1 Task 3b fix: openai and anthropic recorded cheaply

- The owner added $5 credit to both accounts and asked to spend as little as
  possible. `record-streams.ts` gained `RECORD_TWINS` (restrict non-streaming
  twin calls to the named cases; `RECORD_TWINS=max_tokens` here — tool-case
  twins can't be embedded until Tasks 8–10) and now logs upstream request
  counts per provider at the end of a run.
- Model choice (one probe each, per the owner's budget): `gpt-4.1-nano` and
  `claude-3-5-haiku-latest` each got exactly one request and returned HTTP 404
  on these keys; fell back to `gpt-4o-mini` and `claude-haiku-4-5` (the other
  owner-named candidates) — accepted.
- Token caps: `max_tokens` case stays ≤16 (openai 5, anthropic 8); all other
  recorded cases ≤200 — openai `parallel_tool_calls` gained `max_tokens:128`,
  anthropic `parallel_tool_calls` dropped 512→192; `after_tool_result` was
  already 64/128.
- Recorded 2026-10-27 (raw bytes verbatim, `expectedEvents` generated by
  `scripts/stream-fixture-decode.ts`; `source` now reads `recorded: <provider>
  API, <model> (via npm run record:streams)`, the owner-requested format —
  applied to openai/anthropic/gemini prefixes for uniformity with ollama):
  - `openai/parallel_tool_calls` — gpt-4o-mini, two `get_weather` calls
    (Paris, London), finish `tool_calls` → `tool_call`.
  - `openai/after_tool_result` — gpt-4o-mini, text reply after the tool
    result, finish `stop`.
  - `openai/max_tokens` — gpt-4o-mini, `finish_reason:"length"` → `length`;
    twin matched on message/finishReason/usage and is embedded.
  - `anthropic/parallel_tool_calls` — claude-haiku-4-5, two `tool_use`
    blocks (Paris, London), `stop_reason:"tool_use"` → `tool_call`.
  - `anthropic/after_tool_result` — claude-haiku-4-5, text reply, `end_turn`
    → `stop`.
  - `anthropic/max_tokens` — claude-haiku-4-5, `stop_reason:"max_tokens"` →
    `length`; twin matched and is embedded.
- Upstream requests made (hard cap was 15 per provider): openai=5,
  anthropic=5 (each: 1 failed model probe + 3 streamed calls + 1 twin).
  Every case produced the expected shape on the first attempt — no prompt
  retries were needed.
- Still omitted: `openai/error` (no real in-stream trigger known — per the
  owner, not attempted) and `gemini/error` (same; no Gemini case defined).
- Files outside the Files block: none new — `scripts/record-streams.ts` and
  `scripts/record-streams-cases.ts` were already declared in the Task 3b
  entry; the `date` parameter they no longer use was removed from the three
  provider setups and `providerSetups`.

## v1.1 Task 4: postStream, streaming pipeline, route, OpenAI decoder/encoder

- Spec sections implemented: §3.2 (pipeline, postStream, idle timeout,
  client-disconnect abort, in-stream errors, completion log), §3.3 OpenAI row
  (decoder/encoder, usage chunk gated on `stream_options.include_usage`,
  `data: {"error":…}` + `data: [DONE]`).
- Files outside the Files block: `.env.example` (documents the new
  `UPSTREAM_STREAM_IDLE_MS` env var) and `tests/integration/errors.test.ts`
  (Step 1 names the replacement — the openai→openai `stream:true` 501 case is
  now covered by `stream.test.ts`; kept listed here because the Files block's
  Modify list omits it).
- Fix round 1 added `src/services/stream-pipeline.test.ts` (new — the
  prescribed unit test pinning "nothing is encoded after a terminal event";
  the Files block has no pipeline test file) and modified
  `src/services/http-client.test.ts` (postStream unit tests: the msw layer
  can't observe an undici body abort, so the headers-only timeout is pinned
  by stubbing `fetch` and asserting the signal stays un-aborted once headers
  resolve). Both are test files for code inside the block.
- The OpenAI decoder parses `data:` lines individually rather than via strict
  SSE block dispatch: the recorded `tool_call.sse` fixture (openai-go stream
  capture) carries bare `data:` lines with no blank-line separators, and every
  OpenAI `data:` line is a complete JSON payload anyway. Comment/`event:`/
  blank lines are ignored. A stream that ends without `[DONE]` (or with a
  chunk that fails JSON.parse) ends in an `error` event, per §3.2.
- `stream-sdk.test.ts` serves the encoded bytes over a real loopback
  `http.createServer` instead of msw: the OpenAI SDK cancels the response
  reader when it sees `[DONE]`, and that cancellation never resolves on msw's
  synthetic response stream (iteration hangs). Loopback only — no external
  network in `npm test`.
- `stream-decoders.test.ts` runs "every split point" verbatim for fixtures ≤
  4 KB (the plan's bound) and a deterministic ~150-point sample for larger
  recordings — `openai/tool_call.sse` is 74 KB, so an exhaustive split loop
  would be quadratic in decode time.
- Pre-headers non-2xx in `postStream` throws an `UpstreamError` carrying the
  upstream status and parsed body, so proxy.service's `toClientFacing` renders
  exactly the same client error as the JSON path.

## v1.1 Task 5: Anthropic stream decoder/encoder

- Spec sections implemented: §3.3 Anthropic row (event-typed SSE
  decoder/encoder, thinking/signature deltas and ping dropped,
  `input_json_delta.partial_json` → `tool_call_delta`, error events via
  `toCanonicalError`), §3.4 (buffered tool arguments → one
  `input_json_delta`, `_invalid_arguments` wrapper on parse failure).
- Wire-format source checked 2026-10-27:
  https://docs.claude.com/en/api/messages-streaming ("Streaming
  Messages" — event flow `message_start` → `content_block_*` →
  `message_delta` → `message_stop`, `ping` anywhere, `event: error`
  mid-stream; `usage.output_tokens` cumulative in `message_delta`;
  `input_json_delta.partial_json`) and
  https://docs.claude.com/en/api/errors (error `type` ↔ HTTP status
  table used for the decoder's in-stream error mapping:
  `overloaded_error` → 529 → kind `unavailable`, matching the error
  fixture; `billing_error`/`conflict_error` also mapped, unknown types
  fall back to 500).
- `message_end` is emitted on `message_stop`, not `message_delta`:
  `message_delta` only holds the stop reason and cumulative usage.
  Otherwise a stream cut between `message_delta` and `message_stop`
  would emit `message_end` and could not end in an `error` event —
  Review Focus #2 names `message_stop` as the terminal marker.
- Wire `content_block` indices are assigned at emission time, so they
  stay contiguous even when canonical tool events interleave
  (canonical `index` keys the buffer, per §3.1 rule 5); the first call
  to reach `tool_call_end` gets the next content-block index.
- `message_start`'s `message.usage` is `{input_tokens: 0,
  output_tokens: 0}` — the real input count only arrives with the
  canonical `usage` event and lands in `message_delta.usage`
  (`input_tokens` included there too, matching the recorded
  `parallel_tool_calls` fixture and giving SDK `finalMessage()` the
  correct totals).
- `mapFinishReason`/`mapToAnthropicStopReason` are reused as-is from
  the adapter, so unlisted stop reasons (`stop_sequence`, `pause_turn`,
  `refusal`, `model_context_window_exceeded`, `container` deltas)
  follow the non-streaming mapping (default `stop` / `end_turn`).
- Errors before the first byte and retry/timeout behaviour are
  unchanged — they flow through Task 4's `postStream` + `toClientError`
  path, verified by `stream.test.ts` and the remaining 501 rows.
- `errors.test.ts` now filters the `stream:true → 501` rows on a
  STREAMING_ADAPTERS set (openai + anthropic) — replaced rows:
  anthropic→anthropic, anthropic→openai, openai→anthropic, each now
  covered by a named case in `tests/integration/stream.test.ts`.
- Fix round: the encoder's `tool_call_end` now calls `closeText()`
  before emitting `content_block_start{tool_use}` — a text_delta that
  arrived while a call was buffered used to leave its block open across
  the tool block (Anthropic never overlaps content blocks); and
  `message_end`/`error` are terminal — `encode()` writes nothing after
  them.

## v1.1 Task 6: Ollama stream decoder/encoder

- Spec sections implemented: §3.3 Ollama row (NDJSON decoder/encoder —
  `message.content` → `text_delta`, `message.tool_calls` whole →
  start + one `JSON.stringify(arguments)` delta + end, `done:true` →
  `usage` + `message_end`, `{"error":"…"}` → `error` via
  `toCanonicalError`), §3.4 (arguments buffered per canonical `index`
  until `tool_call_end`, `parseToolArguments` → `{}` for empty,
  `_invalid_arguments` wrapper for invalid).
- Wire-format source checked 2026-10-27:
  https://docs.ollama.com/api/chat (NDJSON stream shape — `model`,
  `created_at`, `message{role:"assistant",content}`, `done:false`
  chunks; `message.tool_calls[].function.{name,arguments}`;
  `message.thinking` for think models; final line `done:true`,
  `done_reason`, `prompt_eval_count`, `eval_count`) and
  https://github.com/ollama/ollama/blob/main/docs/api.md ("Chat
  request (Streaming with tools)" example). The recorded 0.40.11
  corpus additionally carries `id` and `function.index` on tool calls
  the docs don't show — the decoder uses the wire `id` when present
  and the encoder emits both fields (fixtures are the oracle).
- `message_start.id` draws from the injected `ids` — Ollama has no
  message id (Task 3 convention: `call_0` under `sequentialIds()`).
- `done_reason` → canonical finishReason: a stream that ended in tool
  calls reports `tool_call` (Ollama itself leaves `done_reason:"stop"`
  there); `"length"` → `length`, `"stop"` → `stop`, anything else →
  `unknown`. The encoder maps back: only canonical `length` stays
  `"length"`, everything else → `"stop"` (the two values Ollama
  documents).
- Mid-stream `{"error":"…"}` → `toCanonicalError(500, …)` = canonical
  `internal`/500 — the wire carries no status, so the same failure
  returned pre-stream (HTTP 500) applies, matching the recorded
  `error` fixture.
- The encoder emits nothing for `message_start` (Ollama opens with the
  first content line) and nothing after `message_end`/`error` —
  terminal guard pinned by a named test.
- `errors.test.ts` STREAMING_ADAPTERS gained `ollama` — replaced
  `stream:true → 501` rows: openai→ollama, anthropic→ollama,
  ollama→ollama, ollama→openai, ollama→anthropic; each streaming pair
  is covered by `stream.test.ts` or the generated contract rows.
- Files outside the Files block: `src/services/proxy.service.test.ts`
  — the two `stream:true → 501` unit cases pinned the openai→ollama
  pair, which now streams by design (spec §1.2 F1); they were
  re-pointed at the openai→gemini pair (gemini is the remaining stub
  until Task 7) so the refusal path stays covered.
- Fix round 1 (owner-requested):
  - `tests/contracts/stream-sdk.test.ts`: module-level
    `currentContentType` is reset to `"text/event-stream"` in a
    `beforeEach`; ollama cases still override to
    `application/x-ndjson` — no case depends on test order.
  - Decoder shape guards: a line that parses as JSON but isn't a
    plain object (number, string, array, `null`) and a
    `message.tool_calls` that isn't an array both emit the same
    canonical `upstream` error as an undecodable line and finish the
    stream — previously the first produced a spurious `message_start`
    (`null` threw) and the second threw from `feed()`.
  - Decoder: a string `function.arguments` passes through verbatim as
    `argumentsDelta` (it is already the JSON encoding); objects keep
    `JSON.stringify`, missing stays `"{}"`.
  - Encoder: calls open at `message_end` flush in ascending canonical
    index as `message.tool_calls` lines just before the `done:true`
    line (one `logger.warn` naming only the count); before an `error`
    event they are dropped (one warn naming the count). A
    `tool_call_delta`/`tool_call_end` for an index that never had
    `tool_call_start` now `logger.warn`s (event type and index only)
    instead of dropping silently; output unchanged.

## v1.1 Task 7: Gemini stream decoder/encoder

- Spec sections implemented: §3.3 Gemini row (SSE `data:` frames of
  `GenerateContentResponse`; text parts → `text_delta`, `functionCall`
  parts → start + one `JSON.stringify(args)` delta + end, last
  `usageMetadata` → `usage` at finish, `finishReason` → `message_end`,
  `{"error":{code,message,status}}` frame → `error`), §3.4 (arguments
  buffered per canonical `index` until `tool_call_end`, `args` via
  `parseToolArguments`).
- Wire-format source checked 2026-10-27:
  https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent
  and the same page's `GenerateContentResponse`, `Candidate`,
  `FunctionCall`, `UsageMetadata` and `FinishReason` references —
  `candidates[].content.parts[].{text,functionCall{name,args,id}}`,
  `finishReason` values, `usageMetadata.{promptTokenCount,
  candidatesTokenCount,totalTokenCount}`, `responseId`, `modelVersion`
  all verified against the docs, not only the fixtures.
- `message_start.id` = the wire `responseId`, `model` =
  `modelVersion` (fixture convention). Tool-call ID = `functionCall.id`
  when present, else the injected `ids` (`call_0`, …). A stream ending
  in function calls reports `tool_call` even though the wire
  `finishReason` is `STOP` (as the recorded corpus shows);
  `MAX_TOKENS` → `length`, `SAFETY`/`RECITATION` → `content_filter`.
- Decoder shape guards (matching the ollama/anthropic convention): a
  payload that isn't a plain object, a `candidates`/`content.parts`
  that isn't an array, or a `functionCall` that isn't an object → one
  `upstream` error event, never a throw. A stream ending without
  `finishReason` ends in an `error` event. No `error` fixture exists
  in Google's published captures (recorded in "v1.1 Task 3"), so the
  error-frame case is built inline in stream-decoders.test.ts.
- Encoder: `ctx.query.alt === "sse"` → `data: <response>\r\n\r\n`
  frames (`text/event-stream` — the CRLF framing the real API uses and
  the SDK's `^data: (.*)(\n\n|\r\r|\r\n\r\n)` regex accepts); otherwise
  a streamed JSON array (`[`, `,\r\n` separators, `]`) with content
  type `application/json` — the `]` still closes after an `error`
  element so the body stays valid JSON. Elements carry `responseId`
  (echoed from `message_start`) and `modelVersion` =
  `ctx.requestedModel`. One candidate element per `text_delta` and per
  completed `functionCall` — a single `functionCall` part per element,
  which is what the installed `@google/generative-ai` 0.24.1 SDK's
  `aggregateResponses` composes correctly (its per-candidate `newPart`
  accumulator merges multi-part candidates). `functionCall.id` is
  written back (documented optional field) so `decode(encode(events))`
  keeps the call IDs.
- `streamRequestPath` on the Gemini chat route →
  `/v1beta/models/<m>:streamGenerateContent?alt=sse` — the only
  provider whose upstream stream endpoint differs from its chat path
  (spec §3.1; the route field itself landed in Task 4).
- The v1.0.1 streaming-refusal path is gone: all four adapters stream.
  The `stream:true`/`:streamGenerateContent` → 501 rows in
  errors.test.ts and the three refusal cases in
  proxy.service.test.ts were replaced by streaming assertions (the
  old → new mapping is listed in the PR). `proxy.service` sets
  `canonical.stream = true` when the stream branch is entered via
  `isStreamPath` — a Gemini `:streamGenerateContent` request carries
  no body flag, and targets that signal streaming in the body
  (openai `stream_options`, anthropic/ollama `stream:true`) need it.
  Without this, `gemini source → openai/anthropic target` silently
  proxied non-streaming upstream bodies through the stream pipeline.
- Files outside the Files block: `src/services/proxy.service.test.ts`
  — the two `stream:true → 501` cases PR #18 re-pointed at a gemini
  target plus the `:streamGenerateContent` refusal case pinned the
  refusal path this task removes; each was rewritten as a streaming
  assertion (named in the task instruction as required).
- Fix round 1 (owner-requested):
  - `mapFinishReason` maps `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`
    and `IMAGE_SAFETY` to `content_filter` alongside
    `SAFETY`/`RECITATION` — all four verified 2026-10-27 against the
    FinishReason enum at
    https://ai.google.dev/api/generate-content#FinishReason.
    `IMAGE_SAFETY` is in the doc but absent from the installed
    `@google/generative-ai` 0.24.1 enum, so the adapter test casts
    it. No other mapping changed (STOP, MAX_TOKENS, the default and
    the encode direction are untouched).
  - Encoder: a `tool_call_start` for an index that is already open
    `logger.warn`s (event type and index only — no names, ids or
    arguments, matching the unknown-index warn) and keeps the first
    call's buffer; the duplicate start is ignored.
  - Decoder: `end()` sets `finished` when it emits the "Upstream
    stream ended without completing" error — a second `end()` or any
    later `feed()` emits nothing.
  - Decoder: a non-object member inside `candidates` or inside
    `content.parts` emits the same `upstream` "Upstream sent an
    undecodable stream chunk" error as the array-shape guards instead
    of being skipped.

## v1.1 Task 8: tool calling for OpenAI and Ollama (non-streaming)

Spec §3.4 rows implemented: OpenAI `tools[].function` ↔ canonical `tools`,
`tool_choice` ↔ `toolChoice` (all four forms), `tool_calls`/`tool_call_id`
already existed for messages and responses. Ollama `tools` pass through,
`message.tool_calls` ↔ canonical `toolCalls` (arguments object ↔ JSON
string), `role:"tool"` results ↔ `tool_name`, and the `toolChoice` gate.

Ambiguities resolved (Ollama):
- Call ids: wire `id` kept when present, `ids()` drawn when absent —
  same rule as the stream decoder and "v1.1 Task 3" conventions. On
  encode the adapter writes `id` and `function.index`, mirroring the
  recorded Ollama 0.40.11 wire shape (the SDK type omits both fields).
- `toCanonicalRequest` has no injected generator, so request-decode
  generated ids come from a local `sequentialIds()` (`call_0`, `call_1`,…
  in emission order) — deterministic and unique within the request.
- `tool_name` pairing on decode: Ollama results carry only the tool's
  name; each `role:"tool"` message is paired with the earliest
  unconsumed earlier assistant call of that name (FIFO). An unmatched
  tool message keeps `tool_name` as its `toolCallId` so the
  information survives and a later Ollama encode fails with the
  spec-required ValidationError naming it. On encode the lookup is by
  canonical `toolCallId`; no match → ValidationError naming the id only.
- `toolChoice`: `auto` (or absent) passes through; anything else throws
  `ValidationError` → 400. The `<value>` in the message is the string
  itself (`"required"`, `"none"`) or `JSON.stringify` of an object form,
  e.g. `Ollama does not support tool_choice "{"type":"function",...}"`.
- `finishReason`: `message.tool_calls` present → `tool_call` (the stream
  decoder's `sawToolCalls` rule); `fromCanonicalResponse` encodes
  canonical `tool_call` as `done:true, done_reason:"stop"` — what
  recorded Ollama tool-call answers carry.
- A string `arguments` on the wire passes through verbatim; objects are
  `JSON.stringify`d; encode uses `parseToolArguments` (`{}` for empty,
  `{ "_invalid_arguments": "<raw>" }` + a warn line without arguments).

Ambiguities resolved (OpenAI): non-function entries in `tools`
(e.g. `type:"custom"`) and `tool_choice` forms with no canonical
equivalent (`allowed_tools`, `custom`) throw `ValidationError` naming
the type rather than being silently dropped. `strict` on a function
tool and other fields canonical cannot express are dropped — follow-up.

Owner decision (2026-10-27, option a): mapping tools necessarily changed
the recorded tool-dropping snapshot; the approval allowed updating
exactly `Adapter golden fixtures > openai > request fixtures > tools →
canonical matches snapshot 1` (gained `tools` only — the fixture carries
no `tool_choice`). Updated via `npx vitest run
tests/contracts/fixtures.test.ts -u -t '<exact test name>'` in its own
commit `test: update tool snapshots (owner-approved, option a)`; no
other snapshot entry and no fixture file changed.

Files outside the Files block:
`tests/contracts/__snapshots__/fixtures.test.ts.snap` (the one entry
above, owner-approved) and `docs/decisions.md` (this entry).

Fix round 1:
- `src/transformers/adapters/ollama.tools.ts` (new, 180 lines) —
  file outside the Files block: the Ollama tool-call conversion and
  name-resolution helpers moved out of `ollama.adapter.ts`
  (477 → 388 lines) for AGENTS.md rule 7 (single-purpose, ~400
  lines), same pattern as `gemini.tools.ts` /
  `anthropic.messages.ts`. Imported only by `ollama.adapter.ts`;
  `ollama.stream.ts` is untouched (it takes
  `toCanonicalError`/`fromCanonicalError` from the adapter). No
  behaviour change.
- OpenAI `function.strict` and `parallel_tool_calls` have no
  canonical equivalent (`parallel_tool_calls` is a spec non-goal):
  still dropped, now with a `logger.debug` naming only the field —
  `Dropping tool field "strict" (no canonical equivalent)` and
  `Dropping request field "parallel_tool_calls" (no canonical
  equivalent)`, the same pattern Task 9 uses for Anthropic's
  `disable_parallel_tool_use`. The request is not rejected.
- OpenAI `type:"custom"` entries in `message.tool_calls` were
  silently filtered on both decode paths, leaving `toolCalls: []`
  under a `tool_call` finish. Request decode now throws
  `ValidationError` → 400 `invalid_request` in the OpenAI dialect;
  response decode throws `UpstreamError` → status 502, canonical
  kind `upstream` — the unrepresentable shape came from the
  upstream, not the client (so not 400) and it is not a proxy bug
  (so not 500 `internal`): the same kind the stream decoders emit
  for undecodable upstream chunks. Both messages name only the
  type, never call names or arguments.
- Ollama encode builds the call-id → name lookup while walking the
  messages, so a tool message resolves only against an assistant
  call that precedes it in the request; a result whose call appears
  only later hits the existing ValidationError naming the id.
- Tests added: `openai strict and parallel_tool_calls are dropped
  with a debug log naming the field`, `openai custom tool_call in a
  request → 400 naming the type`, `openai custom tool_call in a
  response → error naming the type`, `ollama tool message resolves
  only against an earlier assistant call`, `ollama decode pairs two
  same-name results with their calls in order`, `ollama unmatched
  tool_name is kept and fails on Ollama encode`, `ollama string
  arguments pass through verbatim`.

## v1.1 Task 9: tools for Anthropic (non-streaming)

Spec §3.4 (Anthropic messages). Non-streaming `tools` / `tool_choice` /
`tool_use` / `tool_result` mapping in `anthropic.adapter.ts`;
`anthropic.stream.ts` untouched (Task 5 already streams tool_use).

- `tools[]` ↔ canonical tools: `{name, description, input_schema}` ↔
  `{type:"function", function:{name, description, parameters}}`.
  `input_schema` passes through unchanged (spec §3.4: only Gemini
  rewrites schemas). On encode `input_schema` defaults to
  `{"type":"object"}` when canonical `parameters` is absent (the
  Messages API requires an object schema).
- `tool_choice` ↔ `toolChoice`: `auto`→`auto`, `any`→`required`,
  `none`→`none`, `{type:"tool",name}`→`{type:"function",
  function:{name}}`, and back.
- `disable_parallel_tool_use` has no canonical field: **dropped with a
  debug log naming only the field** (`tool_choice`
  `disable_parallel_tool_use` has no canonical equivalent). Not a 400 —
  the choice itself still maps; only the parallel-use hint is lost.
- `tool_use.input` on encode is `parseToolArguments(arguments).args`:
  `{}` for empty, the `{ "_invalid_arguments": "<raw>" }` wrapper plus
  a warn log (without the arguments) for unparseable input. On decode
  `arguments` is `JSON.stringify(input)`.
- `tool_result` decode: a user message with N `tool_result` blocks → N
  canonical `role:"tool"` messages in order, then one user message for
  any remaining text/image blocks (spec §3.4). `tool_result.content`:
  a string passes through; an array's **text blocks join with `"\n"`**.
  Any non-text block in `tool_result.content` (image, document, …) →
  `ValidationError` naming the block type → 400 in the Anthropic
  dialect (`invalid_request_error`). Canonical tool results carry no
  images, so this is never a silent drop.
- `is_error` ↔ `isError`: decode maps only `is_error === true` to
  `isError: true`; encode **omits `is_error` unless `isError ===
  true`** (Anthropic's documented default is false).
- Encode merges each run of consecutive canonical tool messages into
  ONE user message of `tool_result` blocks; an assistant message's text
  precedes its `tool_use` blocks.
- `tools[]` entries that are server-side toolsets (no `name` — e.g.
  `browser_toolset_*`) → `ValidationError` naming the tool type; named
  built-in tools map by `name`/`description` (no `input_schema` → no
  `parameters`).
- Canonical tool messages with array content keep their parts on
  encode (`tool_result.content` accepts text/image blocks); other
  adapters only produce string tool content, so this path is
  theoretical.
- Wire-format source checked 2026-10-27: Anthropic Messages API and
  Tool use docs (docs.claude.com / docs.anthropic.com —
  `tools[].{name,description,input_schema}`, `tool_choice` types
  `auto`/`any`/`tool`/`none`, `tool_use{id,name,input}`,
  `tool_result{tool_use_id,content,is_error}`, `stop_reason:"tool_use"`).
- **Owner decision (2026-10-27, option a):** exactly two existing
  contract snapshot entries updated, purely additive —
  `anthropic > request fixtures > tools → canonical matches snapshot 1`
  gained `tools` (the fixture has no `tool_choice`, so no `toolChoice`),
  and `anthropic > response fixtures > tool_use → canonical matches
  snapshot 1` gained `message.toolCalls`. Updated via targeted
  `vitest -t` runs only; committed separately as `test: update tool
  snapshots (owner-approved, option a)`.
- File split (AGENTS.md rule 7): the message/content/tool conversion
  layer moved to `src/transformers/adapters/anthropic.messages.ts`
  (~317 lines; the adapter would otherwise be ~660). The adapter
  imports it one-way; it depends only on `src/types` and `src/utils`,
  same as `anthropic.stream.ts`.
- Files outside the Files block: `docs/decisions.md` (this entry —
  required by the task to record the mapping choices and the owner
  approval),
  `src/transformers/adapters/anthropic.messages.ts` (the split above),
  and `tests/contracts/__snapshots__/fixtures.test.ts.snap` (the two
  entries above, per the owner decision).
## v1.1 Task 10: Gemini tools (non-streaming) + toGeminiSchema

- Spec sections implemented: §3.4 Gemini row —
  `tools[].functionDeclarations` ↔ canonical `tools` (parameters
  through `toGeminiSchema` on encode); `toolConfig.functionCallingConfig`
  ↔ `toolChoice` (`AUTO`/`MODE_UNSPECIFIED`→`auto`, `NONE`→`none`,
  `ANY`→`required`, `ANY`+`allowedFunctionNames:[n]`→function choice;
  `ANY` with >1 allowed names has no canonical equivalent →
  ValidationError); `functionCall` parts ↔ `toolCalls`
  (`functionCall.id` when present, else injected `ids()`; `id` dropped
  on encode); canonical tool messages → `functionResponse` parts
  (`name` resolved from the matching assistant call in the same
  request; content sent as a JSON object when it parses as one,
  otherwise `{ "content": "<string>" }`; consecutive tool messages
  share one `user` turn; no matching call → ValidationError).
- `toGeminiSchema` allow-list (read 2026-10-27 from
  https://ai.google.dev/api/generate-content#Schema — the Schema
  object moved there from caching#Schema): `type`, `format`, `title`,
  `description`, `nullable`, `enum`, `maxItems`, `minItems`,
  `properties`, `required`, `minProperties`, `maxProperties`,
  `minLength`, `maxLength`, `pattern`, `example`, `anyOf`,
  `propertyOrdering`, `items`, `minimum`, `maximum` — the documented
  fields minus `default`. The doc lists `default` as accepted and
  ignored ("included here and ignored so that developers who send
  schemas with a `default` field don't get unknown-field errors");
  Owner decision (2026-10-27, option a): drop it anyway, keep the
  plan's test verbatim. Recursion into `properties.*`, `items` and
  `anyOf` at every depth; the input is never mutated.
- `Type` case: `type` is passed through verbatim (lowercase
  JSON-Schema values such as `"object"`/`"string"`). The enum table
  lists uppercase names (`STRING`, `OBJECT`, …, plus `NULL`), but
  Google's own `FunctionDeclaration.parameters` /
  `parametersJsonSchema` examples on the same page use lowercase
  (`"type": "object"`, `"type": "string"`, `"type": "integer"`), as
  does the function-calling guide example — lowercase is what those
  documented examples send for this field, so no case mapping.
- `functionCallingConfig.mode: "VALIDATED"` (Mode enum on
  https://ai.google.dev/api/caching#Mode, read 2026-10-27) has no
  canonical equivalent: decode throws ValidationError naming the mode
  (400 in the Gemini dialect); encode never emits it.
- Owner decision (2026-10-27, option a) — contract snapshots:
  approved updating exactly one entry,
  `Adapter golden fixtures > gemini > request fixtures > tools →
  canonical matches snapshot 1` (gains `tools`; the fixture has no
  `toolConfig`, so no `toolChoice`), in its own commit
  `test: update tool snapshots (owner-approved, option a)`.
- Files outside the Files block: none —
  `tests/contracts/__snapshots__/fixtures.test.ts.snap` is the
  owner-approved snapshot update above.
- Fix round 1:
  - Decode: `callIds` was `Map<name, id>`, so a second call to the same
    function overwrote the first and parallel same-name calls got each
    other's results. Now a FIFO queue of pending call ids per name
    (`PendingCallIds`); `functionResponse.id` still wins when present
    (consuming its queue entry); a response with no pending call → the
    existing "no matching function call" ValidationError.
  - Decode: `tools[]` entries with keys other than
    `functionDeclarations` (`codeExecution`, `googleSearch`,
    `googleSearchRetrieval`, …) were silently dropped →
    ValidationError `Gemini tool type "<key>" is not supported` (400),
    consistent with the VALIDATED / multi-name ANY handling.
  - File outside the Files block: `src/transformers/adapters/gemini.tools.ts`
    (new, 339 lines) — the whole tool request/response mapping moved
    out of `gemini.adapter.ts` (734 → 551 lines) for AGENTS.md rule 7
    (single-purpose, ~400 lines); imported only by `gemini.adapter.ts`,
    same pattern as `gemini.schema.ts` / `gemini.stream.ts`. No
    behaviour change beyond the two fixes above.
  - Tests added: `gemini parallel calls to the same function keep
    their own results`, `gemini functionResponse id wins over name
    order`, `gemini non-function tool entry → 400 naming the tool
    type`, `gemini ANY with several allowedFunctionNames → 400` (the
    last covers already-implemented behaviour).

## Conductor: act as the babelgate-conductor GitHub App (owner request, 2026-10-28)

- **What:** the conductor and every Devin session act on GitHub as the GitHub App
  `babelgate-conductor[bot]` (app 5508146, installed on this repository only), not as the
  owner. `scripts/conductor/app-token.sh` mints 1-hour installation tokens from a private key
  kept outside the repo (`~/.config/babelgate-conductor/`); `scripts/conductor/bin/gh` and
  `bin/git-credential-babelgate` fetch a fresh token per call; `app-env.sh` (sourced by
  `devin.sh`, `status-comment.sh`, `as-app.sh`, `start.sh`) sets them up and authors commits as
  the bot. The owner's own shell is unaffected. Same setup as NeoPhylo's conductor, with a
  separate app so a session in one repository holds no key for the other.
- **Permissions:** Contents, Pull requests, Issues read/write; Actions, Checks, Commit
  statuses, Metadata read. No Administration, Workflows, Secrets or Environments. **Actions is
  read-only** because `live.yml` runs with provider API keys and a dispatch executes the
  dispatched branch's code; CI reruns and dispatches are therefore the owner's, and suspected
  flakes are rerun locally (CLAUDE.md "GitHub identity").
- **Why:** under the owner's account the owner could not approve agent PRs (GitHub forbids
  self-approval), received no notifications for escalations, and `/inbox` could not tell owner
  commands from agent comments by author.
- **Owner-only settings** (`docs/conductor/rulesets/apply.sh`, run by the owner): `main` keeps
  its required `check` and `CLAAssistant` checks and gains one Code Owner approval not by the
  last pusher; `v*` tags only by the owner.
- **`.github/CODEOWNERS`:** new, `* @dorrabbkhan`, so every PR needs the owner.
- **`/inbox`:** a command counts only from `dorrabbkhan` with association OWNER; comments by
  the bot are never commands. `status-comment.sh` edits only the bot's own sticky comment.
- **CLA:** the CLA workflow's allowlist (`dorrabbkhan,*[bot]`) already exempts the app; its
  commits are the owner's agents acting on the owner's behalf.

## Conductor: SessionStart hook sets the app identity (owner request, 2026-10-28)

- **What:** `.claude/settings.json` gains a SessionStart hook running
  `scripts/conductor/session-env.sh`, which writes absolute `export` lines (git identity and
  credential helper, the `gh` wrapper first on PATH, `CONDUCTOR_ACTOR`) to `$CLAUDE_ENV_FILE`. Every
  Claude Code session opened in this repo therefore acts as `babelgate-conductor[bot]`, however it
  was started; `start.sh` stays but is optional. On a machine without the app's config the
  hook writes nothing. CLAUDE.md and CONDUCTOR-SETUP.md describe it, with the fallback check
  (`printenv CONDUCTOR_ACTOR` empty → use `as-app.sh`).
- **Why:** in a plain `claude` session, the conductor's own `gh` calls (escalations, /inbox
  acknowledgements) went out as the owner, who gets no notification for their own comments.
- **Shell:** export lines rather than sourcing `app-env.sh`, which is bash-only; the owner's
  shell is zsh. Verified with a fresh headless session: commits authored by the bot.

## v1.1 Task 11: Claude Code essentials

- **`token-estimate.ts` lives in `src/utils/`, not `src/services/`** (Files-block
  deviation): the Anthropic stream encoder needs `estimateInputTokens` for
  `message_start.usage.input_tokens`, and adapter files may only import
  `src/types/`, `src/utils/` and own-provider helpers. A `src/services/` home
  would be unimportable there; services may import utils, so
  `src/utils/token-estimate.ts` (+ `src/utils/token-estimate.test.ts`) serves
  both `count_tokens` (proxy.service) and the encoder.
- **The `message_start` estimate is derived inside the encoder** as
  `estimateInputTokens(toCanonicalRequest(ctx.sourceRequest))` — the same body
  the service decoded, re-run through the pure converter. Passing a precomputed
  number would need a new field on `StreamEncoderContext`, which the task notes
  reserve as an owner-level interface change; `sourceRequest` is the existing
  context field that already carries the client's request (the same channel
  `openai.stream.ts` uses for `stream_options`). `canonical.types.ts` is
  unchanged and `message_delta` still carries the real upstream counts.
- **Files outside the Files block:** `src/transformers/adapters/anthropic.messages.ts`
  (block-level drop/ValidationError logic — the message-decode layer the
  adapter delegates to) and `src/transformers/adapters/anthropic.stream.ts`
  (the `message_start` estimate and the thinking-delta drop logs). Both are
  own-provider helper files under the same import rules as `anthropic.adapter.ts`.
- **`src/routes/proxy.ts` was listed as "modify" but needed no change:**
  `result.headers` was already applied before both the JSON and stream paths,
  so the `x-babelgate-token-estimate` header flows through unchanged.
- **`estimateInputTokens` counts system text once.** Every adapter keeps the
  system text in both `systemPrompt` and a `system`-role message; a literal
  "system prompt + all message text" formula double-counts it (live check: a
  26-char request estimated 11 tokens instead of 7). When `systemPrompt` is
  set, `system`-role messages are skipped; when it is absent their text counts
  as message text.
- **`count_tokens` route ordering:** the route precedes the `/v1/messages`
  chat route in `PROVIDER_ROUTES.anthropic` — routes match by `startsWith` in
  order, and the two share the prefix.
- **Ambiguities resolved:** an invalid `MODEL_MAP` entry is an empty pattern,
  an empty model or no `=` (per trimmed entry; `MODEL_MAP` unset/blank → no
  rules); glob `*` matches an empty run but the literals around it stay
  (`x-*-z` does not match `x-z`); `TARGET_CONTEXT_WINDOW` must be a positive
  integer (`ConfigurationError` otherwise); forwarding and completion log
  lines carry both `model` (mapped, upstream-bound) and `requestedModel`
  (client's name) per §3.5 "logs show both".

## v1.1 Task 12: property tests + launch-pair matrix

- **`decode(encode(events))` is asserted event by event** against `wireNormalForm(provider, events)` —
  the exact sequence each wire can carry — with the reassembled `{message, finishReason, usage}` kept
  as an additional end-to-end check. The normal form rewrites only what the wire genuinely cannot
  carry, each rule documented with the encoder/decoder line it comes from: Anthropic/Gemini/Ollama
  collapse each call to `[tool_call_start, one tool_call_delta =
  JSON.stringify(parseToolArguments(args).args), tool_call_end]` at the position of its `tool_call_end`
  (the plan's named exception; non-tool events between start and end keep their order); OpenAI moves
  `tool_call_end`s to just before the trailing usage/`message_end` in start order (its decoder closes
  calls at the finish chunk), moves `usage` to just before `message_end` (emitted at `[DONE]`), and
  drops empty `tool_call_delta`s (the decoder only emits non-empty `function.arguments`); Ollama
  replaces `message_start.id` with the decoder-generated `"call_0"` and always reports usage.
  Everything else — message ids, text-delta boundaries, interleaved deltas, ids, names and raw
  argument strings — round-trips verbatim. The reassembled check still compares tool arguments in wire
  form (raw JSON string for OpenAI, `parseToolArguments`-normalized object for the others, covering
  the `_invalid_arguments` wrapper). `ARGS_POOL` includes `""` so the empty-arguments edge
  (Review Focus 5: Anthropic/Gemini/Ollama clients get `{}`) is exercised. This also feeds fully
  interleaved deltas to every encoder — the §3.1-rule-5 buffering the other tests only exercise for
  Anthropic.
- **Generated sequences stay inside what every wire can carry:** tool-call ends in index order
  (out-of-order ends would renumber decoded calls — a wire limitation, not a canonical one);
  `finishReason` is `tool_call` exactly when calls exist else `stop`/`length`; `usage.totalTokens` is
  always input+output (Anthropic and Ollama recompute it); and usage is always generated for
  Anthropic/Ollama, whose wire streams always carry counts (their decoders emit a usage event even when
  the encoder saw none).
- **`tests/mocks/upstreams.ts`**: `streamCase` now also drives non-stream replies via exported
  `nonStreamBody(provider)`, built on the exported `nonStreamSource(provider)` selector so the
  matrix's expectations come from the same oracle the mock serves. Resolution order: `"text"` → the
  recorded `responses.basic`; a named fixture response (`openai.tool_call`, `anthropic.tool_use`); the
  recorded non-streaming twin (`<case>.nonstreaming.json`, then the `<case>.json` `nonStreaming`
  field); last, the case's documented `expectedEvents` reassembled and re-encoded in the provider's
  dialect. The derive path exists because no recorded parallel-tool-calls non-stream body exists for
  OpenAI/Anthropic/Gemini (fixtures are owner-only changes); it uses only oracle `expectedEvents` plus
  the provider's own encoder.
- **Non-stream matrix expectations are oracle-only:** when the mock serves a recorded body the
  expectation parses that recording; on the derive path it is `reassembleStream(expectedEvents)`
  directly — never re-parsed from the adapter-derived body — and each cell asserts the exact call
  count, names and distinct ids (`tool_call` → 1, `parallel_tool_calls` → 2, text cases → 0 calls and
  non-empty text) so a misconfigured or zero-call mock cannot pass vacuously.
- **Ollama tool-case twins stay out of the twin property** because `<case>.nonstreaming.json` is a
  separate live recording whose call ids differ from the stream's — Ollama keeps the wire tool-call
  ids (`ollama.tools.ts`; only the message id is a generated UUID), so the differing ids are real and
  the fixtures mark `nonStreaming: null`.
- **Files outside the Files block:** `docs/decisions.md` (this entry; the task's Files block lists only
  the two new test files and `tests/mocks/upstreams.ts`).
- **`tests/integration/stream-pairs.test.ts` is ~640 lines and `tests/contracts/stream-properties.test.ts`
  ~645 — above the ~400 guideline.** The generated-matrix test files in this suite already run past that
  (`stream-sdk.test.ts` 1170, `stream.test.ts` 701, `stream-decoders.test.ts` 471); each file is still
  single-purpose, so splitting wasn't done. Task 17 can lift the source/target dialect helpers out when
  it widens the matrix to 16 pairs.

## v1.1 Task 13: CLI + presets

- **`package.json`:** added only `bin` (`babelgate` → `dist/cli.js`) and `files`
  (`dist`, `README.md`, `LICENSE`, `NOTICE`). `name`, `version`, `publishConfig`
  and scripts untouched; `dist/cli.js` gets its `#!/usr/bin/env node` shebang
  from `src/cli.ts` (tsc preserves it).
- **`src/index.ts`:** the server bootstrap moved into an exported
  `startServer(): Promise<Server>` guarded by `require.main === module`, so
  importing it (as `src/cli.ts` does) opens no socket. `npm start`,
  `npm run dev` and the Docker `CMD ["node", "dist/index.js"]` still run the
  module directly and behave exactly as before, including the
  "Invalid configuration" fatal on bad env and the graceful-shutdown handlers
  (now registered inside `startServer`, so CLI-started servers get them too).
- **Ambiguities resolved:**
  - "User env wins" counts a key as set only when its value is non-empty —
    `loadConfig` already treats `""` as unset for every var it reads, and a
    `.env` copied from `.env.example` (`SOURCE_API=` blank) must not disable a
    preset.
  - `MODEL_MAP` is emitted only when `--model` is passed; a model-less
    `claude-*=` rule would be invalid. `--model` has no effect under the
    `openai-apps` preset (spec names no mapping there).
  - `--base-url` targets `<TARGET>_API_BASE_URL`, falling back to a valid
    `TARGET_API` in the env when `--target` isn't passed; it throws naming
    `--base-url` when neither exists.
  - `--port` flows through `PORT`, so the port `clientInstructions` prints is
    always the resolved `config.port` the server actually bound.
  - `main` catches parse/startup failures, prints the message to stderr and
    sets `exitCode = 1`; upstream keys are never accepted as flags or printed
    (only the client-facing `PROXY_API_KEY` appears in the export lines, per
    spec §3.6).
- **Review fixes:**
  - `startServer` now calls `app.listen(port)` with no callback and resolves
    on `server.once("listening")` / rejects on `server.once("error")`.
    Express 5 registers a passed callback on both `listening` and `error`,
    so on EADDRINUSE the callback ran and `resolve(server)` won — the
    process printed the export lines (or nothing, for `node dist/index.js`)
    and exited 0 with nothing listening. The same silent-exit behaviour
    existed on `main` for `npm start` / the Docker CMD since the
    `startServer` refactor; it is now fixed for both entry points. The
    SIGTERM/SIGINT handlers are registered only after `listening`, not on a
    failed bind.
  - The claude-code `UPSTREAM_TIMEOUT_MS=600000` preset value keys off the
    effective target — `--target`, else a valid `TARGET_API` in the env —
    via a shared `effectiveTarget` helper, exactly as `--base-url` already
    resolved it. Previously only `args.target === "ollama"` counted, so
    `TARGET_API=ollama` in the env got no timeout.
  - Two stderr warnings were added before the server starts (via
    `console.error`, never the logger, names only — never env values): one
    naming the env keys that overrode preset/flag values
    (`overriddenKeys(args, env)`), and one for `--preset claude-code`
    without `--model` and no `MODEL_MAP` in the env (claude-* model names
    are forwarded unchanged).
  - The printed export lines follow the resolved `config.sourceApi`, not
    `args.preset`: if the user's env overrides `SOURCE_API` (e.g.
    `SOURCE_API=openai` with `--preset claude-code`) the lines for the
    source that actually runs are printed, via a small source→preset
    mapping that reuses `clientInstructions` unchanged.
- **Files outside the Files block:** `docs/decisions.md` (this entry; the
  task's Files block lists `src/cli.ts`, `src/cli.test.ts`, `package.json` and
  `src/index.ts`).

## v1.1 Task 15: live streaming/tools suite + Claude Code edit gate

- **OpenRouter base URL is `https://openrouter.ai/api`, not the plan's
  `https://openrouter.ai/api/v1` (plan defect).** Upstream URLs are built by
  plain concatenation — `${targetBaseUrl}${requestPath}` in
  `proxy.service.ts` — and the OpenAI request path already carries `/v1`
  (`/v1/chat/completions`). With `/api/v1` the upstream URL would be
  `/api/v1/v1/chat/completions`. OpenRouter's documented endpoint is
  `https://openrouter.ai/api/v1/chat/completions`
  (https://openrouter.ai/docs/api-reference/overview), so the base must be
  `https://openrouter.ai/api`. Applied in `liveTargets()`/`useTarget`
  (`tests/live/live.helpers.ts`) and in
  `scripts/gates/claude-code-edit.sh` (`--base-url https://openrouter.ai/api`).
- **`.github/workflows/live.yml` is not in this commit.** The conductor app
  has no Workflows permission, so the one-line env addition
  (`OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` on the
  "Run the live suite" step) is attached to the PR description as a patch
  for the owner to apply.
- **`"openrouter"` is a `LiveTarget`, not a `Provider`** — the union type
  lives in `tests/live/live.helpers.ts`; no `src/` type changed. It borrows
  the OpenAI provider: `useTarget` sets `TARGET_API=openai` with the
  OpenRouter base URL and `OPENROUTER_API_KEY`, and restores the real
  `OPENAI_API_KEY`/`OPENAI_API_BASE_URL` for other targets so the borrowed
  credentials can't leak into real `openai` cases in the same process.
- **Forced tool call covers both sources** on the openrouter target:
  OpenAI `tool_choice: "required"` and Anthropic `tool_choice: {"type":"any"}`
  — both map to canonical `"required"`, which the OpenAI adapter sends
  upstream as `"required"` (OpenRouter forwards `tool_choice` per
  https://openrouter.ai/docs/api-reference/overview; Anthropic documents
  `type:"any"` as "must use a tool" at
  https://docs.anthropic.com/en/api/messages).
- **Gate flags from `claude --help` 2.1.311:** `-p`,
  `--permission-prompts none` (denies anything that would prompt),
  `--allowedTools "Edit" "Write" "Bash(npm test)"` (file edits and
  `npm test` only), `--strict-mcp-config` and `--setting-sources local`
  (the temp dir has no `.claude`, so user/project/MCP config can't widen
  the tool set). `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` are unset for the
  run so the printed `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` decide
  routing; the auth token is the client-facing proxy token the CLI prints.
- **`OLLAMA_API_BASE_URL` default in the gate:** env-config requires
  `<TARGET>_API_BASE_URL` for the selected target, so the ollama run
  supplies `http://localhost:11434` when the env doesn't set it.
- **Files outside the Files block:** `vitest.config.ts` (added
  `scripts/gates/fixtures/**` to the vitest exclude — the edit-task
  fixture's failing `sum.test.js` is picked up by vitest's default include
  and would break `npm test`), `docs/decisions.md` (this entry),
  `.github/workflows/live.yml` (patch only, see above — not committed).

### Fix round 1 (review of PR #31)

- **Stale live stream case replaced (owner-approved expected-value
  change).** `tests/live/errors.live.test.ts`:
  `"$source → $target stream:true → 501 in source dialect"` →
  `"$source → $target stream:true → 200 stream in source dialect"` —
  asserts status 200, the source's streaming content type (SSE for
  openai/anthropic/gemini, NDJSON for ollama) and a terminal event in the
  source dialect (`data: [DONE]`, `data: {"type":"message_stop"}`,
  last-frame `candidates[0].finishReason === "STOP"`, `done: true`
  NDJSON line), mirroring `tests/integration/stream.test.ts`. Gemini
  still signals streaming in the path — the case uses
  `:streamGenerateContent?alt=sse`. `UNSUPPORTED_CHECKS` removed
  (nothing else used it). The file is outside the task's Files block.
  Owner sign-off: Dorrabb Khan, 2026-10-28 — 501→200 live stream case approved.
- **OpenRouter `streams text` token budget:** the case relied on
  `chatCall`'s 16-token `max_tokens` default, which can truncate before
  a text delta or usage; the `openrouter` target now gets the same 512
  budget as `ollama`. The other openrouter cases (`accepts tool
  definitions`, `forced tool call`) already set explicit budgets.
- **Files outside the Files block (fix round 1):**
  `tests/live/errors.live.test.ts` (expected-value change above),
  `.gitignore` (`!/scripts/gates/fixtures/**` negation after the `*.js`
  rule — the PR's own follow-up note; the gate fixture's `.js` files no
  longer need force-add), `docs/decisions.md` (this entry).

### Edit gate run (owner decision on D3, 2026-10-28)

- **D3 deviation: the PR #31 gate ran on OpenRouter
  `poolside/laguna-s-2.1:free`, not on `qwen3-coder:30b` or
  `qwen/qwen3-coder`.** `scripts/gates/claude-code-edit.sh openrouter
  poolside/laguna-s-2.1:free` → `GATE PASS` in 36 s (Claude Code 2.1.311,
  run on the owner's machine with `CLAUDE_CODE_MAX_OUTPUT_TOKENS=16000`).
  This shows Claude Code completing the edit task through babelgate on a
  real remote model; it does not cover the Qwen models D3 names. What
  was tried:
  - **Local `qwen3-coder:30b`:** doesn't fit the owner's laptop (30 GB
    RAM, no usable GPU, CPU-only Ollama in Docker). Loading it hit a
    global OOM: llama-server reached 17 GB RSS — Ollama's fit check
    projected 7.5 GB host memory and left out the 13.4 GB `CPU_REPACK`
    buffer — and systemd-oomd killed GNOME Shell. The owner has no
    machine large enough, so a local 30B run is not planned.
  - **Local `qwen2.5-coder:7b` (tried as a lighter stand-in):** `GATE
    FAIL` after 500 s. Memory was fine (≥ 13 GB free throughout), but
    CPU prompt processing ran at ~34 tokens/s, so a ~10.5k-token Claude
    Code request takes ~5 min before the first byte; the first call
    hit the 300 s stream idle timeout (D5, unchanged) and the one reply
    that completed emitted its tool call as text in a ```json block,
    not a native tool call (the "local models call tools unreliably"
    risk in the spec). No babelgate defect found.
  - **OpenRouter `qwen/qwen3-coder` (paid):** the owner's key has only
    a small remaining budget. OpenRouter rejected the request before
    the model ran (Claude Code's default 65 536 `max_tokens` exceeded
    the 40 000 tokens the key could afford); `qwen/qwen3-coder:free`
    returns 404 "This model is unavailable for free". babelgate
    forwarded `max_tokens` unchanged, as it should. 16-token live
    requests to the paid model succeed, so a capped rerun
    (`CLAUDE_CODE_MAX_OUTPUT_TOKENS` below the key's budget) may pass.
- **OpenRouter `qwen/qwen3-coder` (the D3 model) also passed:**
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000 scripts/gates/claude-code-edit.sh
  openrouter` → `GATE PASS` in 14 s (Claude Code 2.1.311, owner's
  machine, 2026-10-28).
- **`CLAUDE_CODE_MAX_OUTPUT_TOKENS`** caps Claude Code's requested
  output budget; the gate script passes the caller's environment
  through, so no script change was made. Keys with a spend limit need it.
- **Ollama path: Claude Code gate not run; accepted risk (owner
  decision).** Every route to a capable model on Ollama was blocked:
  local `qwen3-coder:30b` doesn't fit and local `qwen2.5-coder:7b` is
  too slow on CPU (above), and Ollama Cloud needs paid credits
  (`qwen3-coder:480b-cloud` → 400 "retired on July 15, 2026";
  `glm-5.3-flash:cloud` → 400 "Add usage credits"). The cloud runs did
  confirm the error path: upstream 400s reached Claude Code through
  babelgate intact. What the gate checks is covered in two halves:
  Claude Code end to end through babelgate by the OpenRouter pass
  above, and the Ollama adapter against a real Ollama server by the
  live suite (`qwen2.5:0.5b`, nightly in CI). Not covered: Claude Code
  ↔ Ollama on a capable model; rerun `scripts/gates/claude-code-edit.sh
  ollama <model>` when credits or a GPU are available.
- **Local live-suite run, owner's machine, 2026-10-28:** 66 passed,
  24 failed (90). Every `ollama`-target case passed, including all 10
  streaming and tool cases in `stream.live.test.ts`. The 24 failures
  are test-suite defects, not babelgate defects, and go to fix round 2:
  - 8 `anthropic`-target and 8 `gemini`-target cases: the default live
    models are retired upstream (`claude-3-5-haiku-latest` → 404;
    `gemini-2.0-flash` → 404 "no longer available").
  - 4 `openrouter` cases from the `gemini`/`ollama` sources:
    `chatCall` sets no output limit for those dialects
    (`tests/live/live.helpers.ts`), so OpenRouter assumes 65 536 tokens
    and rejects on credit; the `openai`/`anthropic` sources send
    `max_tokens: 16` and pass.
  - 4 `openrouter` "unknown model → 404" cases: OpenRouter answers an
    unknown model with 400 "is not a valid model ID", not 404; the
    expected status is wrong for this target (an expected-value change,
    needs owner approval).
- **Before Task 16 / the release:** the nightly live suite's OpenRouter
  cases need credit on `OPENROUTER_API_KEY`.
- **Gemini target merged without a clean live rerun:** the `gemini`
  chat and stream cases failed only on the free-tier quota (429) and a
  503 "high demand"; `gemini-3.8-flash` itself resolves (the model-list
  cases pass). Run the gemini target live once on a fresh quota or a
  paid tier before the release.
- Owner sign-off: Dorrabb Khan, 2026-10-28 — D3 deviation accepted
  (OpenRouter gate passed on qwen/qwen3-coder; Ollama Claude Code gate
  not run, accepted risk); merging without the Gemini live rerun.

### Fix round 2 (owner live run)

The owner's `npm run test:live` on 2026-10-28 (66 passed, 24 failed) —
every failure a live-suite defect, not a babelgate defect — fixed as:

- **Retired default live models** (`DEFAULT_LIVE_MODELS` in
  `tests/live/live.helpers.ts`; `LIVE_<TARGET>_MODEL` overrides
  unchanged): `anthropic`: `claude-3-5-haiku-latest` → `claude-haiku-5-5`
  (upstream 404 `not_found_error`); `gemini`: `gemini-2.0-flash` →
  `gemini-3.8-flash` (upstream 404 "no longer available"). The README
  live-suite bullet naming the same defaults was updated to match.
- **`chatCall` output limit for the gemini and ollama sources:**
  `generationConfig.maxOutputTokens: 16` and `options.num_predict: 16`
  respectively — with no limit OpenRouter assumes 65 536 tokens and
  rejects on credit (400 "more credits, or fewer max_tokens"). Caller
  `generationConfig`/`options` in `extra` merge over the defaults, so
  explicit budgets still win. Request bodies only; no assertions
  changed.
- **OpenRouter unknown model → 400 (owner-approved expected-value
  change).** `tests/live/errors.live.test.ts` "unknown model" case:
  `404` + `NOT_FOUND_CHECKS` for every target → `400` +
  `INVALID_REQUEST_CHECKS` for the `openrouter` target only (OpenRouter
  answers an unknown model with 400 "is not a valid model ID";
  https://openrouter.ai/docs/api-reference/errors); every other target
  keeps 404 + `NOT_FOUND_CHECKS` unchanged. Not a provider-pair special
  case — a test expectation for a target whose upstream status differs;
  no `src/` change. Owner sign-off: Dorrabb Khan, 2026-10-28 —
  OpenRouter unknown model → 400 approved.
- **Files outside the Files block (fix round 2):** `README.md`
  (live-suite default model names), `docs/decisions.md` (this entry).
