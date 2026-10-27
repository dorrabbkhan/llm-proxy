# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dorrabbkhan/llm-proxy/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/dorrabbkhan/llm-proxy/releases/tag/v1.0.1
