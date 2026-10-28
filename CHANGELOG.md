# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-10-28

### Fixed

- **`npx babelgate` crashed on start** with
  `Error: unable to determine transport target for "pino-pretty"` unless
  `NODE_ENV=production`. The logger always configured the `pino-pretty`
  transport outside production, but `pino-pretty` is a devDependency and
  is absent in an npm/npx install. The pretty transport is now used only
  when it is actually resolvable; otherwise the logger writes plain JSON
  to stdout. The Docker image (`NODE_ENV=production`) was unaffected.
- **dotenv startup banner removed.** `dotenv.config({ quiet: true })`
  stops dotenv 17's `◇ injected env …` line from polluting the CLI's
  printed `export` lines.

### Added

- **Packed-install smoke test** (`scripts/ci/smoke-pack.sh`) in the full
  check gate: builds, `npm pack`s, installs the tarball with
  `--omit=dev` in a clean directory, and runs the `babelgate` bin the
  way `npx` does — `--help` must print usage and a real start must bind
  and answer `/health`, both free of the dotenv banner.
- **`prepublishOnly` runs the full check** (`./scripts/check.sh`,
  including the smoke test) so a broken pack can't reach npm again.

## [1.1.0] - 2026-10-28

Public launch — "Claude Code on anything": Anthropic-format clients
(Claude Code) and OpenAI-SDK apps run against Ollama and OpenAI-compatible
backends with streaming and tools, from one `npx babelgate` command.

### Added

- **Streaming end to end in all four adapters.** `stream: true` — and
  Gemini's `:streamGenerateContent?alt=sse` — now flows chunk-by-chunk in
  each side's own wire protocol (SSE for OpenAI, Anthropic and Gemini;
  NDJSON for Ollama) instead of returning 501. Streams are typed
  `CanonicalStreamEvent`s through a provider-agnostic pipeline: a client
  disconnect aborts the upstream request, an upstream that dies mid-stream
  produces an in-stream error in the client's dialect, and
  `UPSTREAM_STREAM_IDLE_MS` (default 300 000) cuts stalled streams.
- **Tool calling end to end in all four adapters.** Tool definitions,
  `tool_choice`/`toolChoice`, parallel calls, streamed tool-call deltas
  and tool results map through canonical. Arguments that aren't valid
  JSON reach the model as `{ "_invalid_arguments": "<raw>" }`; empty
  arguments become `{}`; calls keep their own IDs (`call_<n>` generated
  where the provider has none).
- **Claude Code essentials.** `POST /v1/messages` (any query) and
  `POST /v1/messages/count_tokens` on the Anthropic source; count_tokens is
  a local `ceil(chars/4)` estimate marked `x-babelgate-token-estimate: true`.
  `MODEL_MAP` (ordered `glob=model` rules) rewrites model names upstream
  while replies keep the name the client asked for;
  `TARGET_CONTEXT_WINDOW` sets Ollama's `num_ctx`. `thinking` blocks,
  `cache_control` and `metadata` are dropped safely.
- **`babelgate` CLI.** `npx babelgate` parses flags with `node:util`,
  honours user env over preset values, starts the server and prints the
  client `export` lines. Presets `claude-code` (prints
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`) and `openai-apps` (prints
  `OPENAI_BASE_URL`/`OPENAI_API_KEY`); flags `--preset`, `--target`,
  `--model`, `--base-url`, `--port`, `--help`.
- **Docker image on GHCR.** Release tags (`v*`) publish
  `ghcr.io/dorrabbkhan/babelgate:<version>` and `:latest` via
  `.github/workflows/release.yml`. npm publishing stays a manual step.
- **Release gate + live streaming suite.**
  `scripts/gates/claude-code-edit.sh <ollama|openrouter> [model]` runs
  Claude Code through the proxy on a real edit task and prints
  `GATE PASS`/`GATE FAIL`; `npm run test:live` gained streaming and tool
  cases plus an `openrouter` target (`OPENROUTER_API_KEY`).
- **Stream fixture corpus and stream contract tests** — recorded wire
  bytes per provider, decoded identically at every chunk split, parsed
  back with the providers' own SDKs, plus property tests over the stream
  event-ordering rules.

### Changed

- **Renamed llm-proxy → babelgate** — package name (npm `babelgate`),
  repository docs and the OpenAI `owned_by` fallback.
- **`stream: true` no longer returns 501** in any dialect (spec F1) —
  the one intentional wire-behaviour change of this release. Ollama
  requests that omit `stream` still get a single JSON reply.

### Known limitations

- The launch-verified streaming × tools pairs are `anthropic → ollama`,
  `anthropic → openai` (incl. OpenAI-compatible backends) and
  `openai → ollama`; the full 16-pair matrix is milestone 2.
- The Claude Code ↔ Ollama path was not gate-tested on a capable model
  before release (accepted risk); local models may call tools
  unreliably, and CPU-only machines can hit the
  `UPSTREAM_STREAM_IDLE_MS` stream idle timeout.
- Reasoning/thinking is not mapped (dropped); `parallel_tool_calls` is
  ignored; `count_tokens` is an estimate; the Gemini target and
  Gemini/Ollama sources have not had a clean live run.

## [1.0.1] - 2026-10-27

Correctness patch and public-repo hygiene: makes v1.0's claims true against
real upstreams, renders every error in the client's own provider format, and
gets the repository ready for outside contributors.

### Fixed

- **Ollama chat requests failed with a 500 (E1).** Ollama's own API
  streams NDJSON by default; when the client omitted `stream`, the
  streamed upstream reply crashed the proxy's JSON response path and the
  client got a 500 `TRANSFORM_ERROR` instead of a reply. The Ollama
  adapter now sends `stream: false` upstream when the client omitted
  `stream`.
- **Non-JSON upstream bodies failed confusingly (E2).** A 2xx upstream
  reply that isn't JSON now returns 502
  `Upstream returned a non-JSON response (content-type: <type>)` instead of
  a transform crash.
- **Gemini clients' model was ignored (E10).** The proxy now takes the
  model from `POST /v1beta/models/<m>:generateContent` (URL-decoded,
  slashes kept) instead of sending a hard-coded model upstream.
- **Unsupported Gemini methods were silently answered as chat (E11).**
  `:countTokens`, `:embedContent` and other non-chat methods now return
  501 `<method> is not supported` in the Gemini dialect.

### Changed

- **Errors on configured provider routes are rendered in the client's
  provider format** — OpenAI, Anthropic, Gemini and Ollama error bodies —
  so client SDKs raise their native exceptions. This covers upstream
  failures, auth rejections, malformed JSON and oversized bodies on those
  routes; non-provider paths (unknown routes, `/health`) keep the generic
  `{error:{message,code,status}}` shape.
  **Compatibility note:** the old `{error:{message,code,status}}` shape is
  gone on provider routes; clients that parsed it must switch to their
  SDK's error types.
- **Upstream status mapping is honest about who failed:** 400/422 → 400,
  404 → 404, 413 → 413, 429 → 429 with `Retry-After` passed through,
  503/529 → 503, other 5xx → 502. Upstream 401/403 — including Gemini's
  `400 API_KEY_INVALID` — becomes 502
  `Upstream <provider> rejected the proxy's credentials (<status>)`,
  because the proxy's upstream key failed, not the client's.
- **`PROXY_API_KEY` works with each provider's native auth header:**
  `Authorization: Bearer` (case-insensitive scheme), `x-api-key`,
  `x-goog-api-key` and the `?key=` query parameter. Client credentials are
  never forwarded upstream.
- **Ollama-format requests that omit `stream` get a single JSON reply.**
  This differs from Ollama's own API, which streams by default — send
  `"stream": false` explicitly. `"stream": true` returns 501 until v1.1.
- **Request logs redact credentials**: client auth headers and `?key=`
  query parameters no longer appear in request log lines.
- **Live suite default Ollama model is `qwen2.5:0.5b`** (a small
  non-thinking model; `LIVE_OLLAMA_MODEL` overrides, e.g. for
  `qwen3:0.6b`).

### Added

- **Opt-in live suite** (`npm run test:live`, `tests/live/`): the real app
  against real upstreams — Ollama always, paid providers when their API
  keys are set. Asserts response shapes only. Nightly GitHub Actions job
  against a fresh Ollama.
- **CI** (`.github/workflows/ci.yml`): `./scripts/check.sh` plus a Docker
  build on every PR and push to main.
- **Apache-2.0 licence** (`LICENSE`, `NOTICE`) and a Contributor License
  Agreement (`CLA.md`) enforced by CLA Assistant on PRs.
- **Contributor docs**: `CONTRIBUTING.md`, `SECURITY.md`, issue templates
  (bug, provider request, feature) and a PR template.

### Known limitations

- **Streaming is not transformed.** `stream: true` in any dialect — and
  Gemini's `:streamGenerateContent` — returns 501
  `Streaming is not supported yet (planned for v1.1). Send "stream":
  false.` until v1.1.
- **Ollama `thinking` output is dropped** by the proxy (the canonical
  format has no field for it); planned for v1.1.

[Unreleased]: https://github.com/dorrabbkhan/babelgate/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/dorrabbkhan/babelgate/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/dorrabbkhan/babelgate/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/dorrabbkhan/babelgate/releases/tag/v1.0.1
