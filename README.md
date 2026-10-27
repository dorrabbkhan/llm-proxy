# llm-proxy

A small proxy that sits in front of LLM APIs and translates between their
request/response formats. Point your OpenAI client at it, and it can talk to
Gemini, Ollama, or Anthropic behind the scenes — and vice versa.

Supported providers right now:

- OpenAI
- Google Gemini
- Ollama
- Anthropic (Claude)

## How it works

The naive way to build this is a transformer per provider pair. That gets
painful fast — four providers means twelve conversion functions in each
direction, and every new provider adds another batch.

Instead, every request goes through a **canonical format** in the middle:

```
OpenAI request ──► canonical ──► Gemini request
Gemini response ──► canonical ──► OpenAI response
```

Each provider has an _adapter_ that knows how to convert its own format to and
from canonical. Adding a provider costs you one adapter file — the rest of the
pipeline doesn't care.

The actual request flow:

1. Request hits the Express app.
2. If the path matches the configured source provider's API prefix
   (e.g. `/v1/chat/completions` for OpenAI), the proxy takes it.
   Otherwise it falls through to a 404.
3. The body is converted to canonical, then from canonical to the target
   format.
4. It's forwarded upstream to `{TARGET}_API_BASE_URL` + the target's
   endpoint, with the right auth headers.
5. The response comes back through the same path in reverse.

Two endpoint kinds are supported:

- **Chat** — the request/response translation described above (OpenAI
  `/v1/chat/completions`, Gemini `/v1beta/models/{m}:generateContent`,
  Ollama `/api/chat`, Anthropic `/v1/messages`).
- **Model list** — GET endpoints (`/v1/models`, `/v1beta/models`,
  `/api/tags`) transform the upstream catalog into the source format,
  so client SDKs and dropdowns work unchanged.

Every completed request logs token usage (`inputTokens`, `outputTokens`,
`finishReason`, upstream latency) via pino — grep for `"Request completed"`.

## Quick start

```bash
npm install
cp .env.example .env
```

For a local Ollama target, `.env` needs three lines:

```bash
SOURCE_API=openai
TARGET_API=ollama
OLLAMA_API_BASE_URL=http://localhost:11434
```

Pull a small model and start the proxy:

```bash
ollama pull qwen2.5:0.5b
npm run dev
```

Then send an OpenAI-style request at the proxy:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5:0.5b", "messages": [{"role": "user", "content": "Hello"}]}'
```

That gets translated to an Ollama `/api/chat` call upstream (the proxy
sends `stream: false` when you don't ask for a stream), and the response
comes back in OpenAI `chat.completion` shape.

## Configuration

Everything is environment variables. One instance serves one source→target
pair; run multiple instances for more.

| Variable                  | What it's for                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `SOURCE_API`              | Format clients send to you — `openai`, `gemini`, `ollama`, or `anthropic`                    |
| `TARGET_API`              | Format to translate to upstream — same options                                               |
| `PORT`                    | Listen port (default `3000`)                                                                 |
| `{PROVIDER}_API_BASE_URL` | Upstream base URL for the target provider, e.g. `OLLAMA_API_BASE_URL=http://localhost:11434` |
| `{PROVIDER}_API_KEY`      | API key for the target provider (Ollama doesn't need one)                                    |
| `UPSTREAM_TIMEOUT_MS`     | Per-request upstream timeout (default `30000`)                                               |
| `UPSTREAM_RETRIES`        | Retries for transport failures / 429 / 503 (default `1`)                                     |
| `MAX_BODY_SIZE`           | JSON body limit (default `10mb` — base64 images need it)                                     |
| `PROXY_API_KEY`           | Optional client auth — when set, callers send the key in their provider's native auth header (see Authentication) |

Routing and upstream endpoints are conventions, not configuration: each
provider's routes (`kind`, `method`, `pathPrefix`, `requestPath`) live in
`PROVIDER_ROUTES` in `src/transformers/adapters/index.ts`. There used to be
a YAML mappings file here — it got deleted because it only ever repeated
these conventions.

## Authentication

Set `PROXY_API_KEY` and every proxied endpoint requires it, in whichever
native auth style the client SDK already sends — any one match
authenticates, and every comparison is timing-safe:

- `Authorization: Bearer <key>` — OpenAI and Ollama SDKs, Anthropic's
  `ANTHROPIC_AUTH_TOKEN` (the `Bearer` scheme is case-insensitive)
- `x-api-key: <key>` — Anthropic SDK
- `x-goog-api-key: <key>` — Gemini SDK
- `?key=<key>` query parameter — Gemini's other auth style

A wrong or missing key gets a `401` in the source provider's error format.
The client key is never forwarded upstream — the upstream sees only the
proxy's own `{TARGET}_API_KEY`. Leave `PROXY_API_KEY` unset to disable
client auth (local dev), and note `/health` stays open either way.

## Errors

Errors on provider routes are rendered in the **source** provider's error
format, so client SDKs raise their native exceptions:

| Source | Error body |
|---|---|
| OpenAI | `{"error":{"message","type","param","code"}}` |
| Anthropic | `{"type":"error","error":{"type","message"}}` |
| Gemini | `{"error":{"code","message","status"}}` |
| Ollama | `{"error":"<message>"}` |

When the upstream provider itself fails, the status the client sees is:

| Upstream | Client | Notes |
|---|---|---|
| 400, 422 | 400 | The upstream message passes through |
| 404 | 404 | Almost always "model not found" — the client can fix it |
| 413 | 413 | Request too large |
| 429 | 429 | `Retry-After` passed through when present |
| 401, 403 | 502 | `Upstream <provider> rejected the proxy's credentials (<status>)` — the *proxy's* upstream key failed, not the client's. Gemini's `400 API_KEY_INVALID` maps here too |
| 503, 529 | 503 | Unavailable |
| Other 5xx | 502 | Upstream failure |
| Timeout | 504 | After `UPSTREAM_TIMEOUT_MS` |
| Transport failure | 502 | Upstream unreachable |
| Non-JSON 2xx body | 502 | `Upstream returned a non-JSON response (content-type: <type>)` |

Request logs redact credentials, and error messages never echo prompt
bodies or API keys. Unknown paths and `/health` keep a small generic
error shape rather than any provider's.

## Project structure

```
src/
├── app.ts                  Express app wiring (middleware → routes → errors)
├── index.ts                Server startup
├── config/env-config.ts    Env var config (lazy, validated)
├── middleware/             pino request logging, error handler
├── routes/proxy.ts         Thin HTTP adapter — delegates to proxy.service
├── services/
│   ├── http-client.ts      Upstream transport: timeout, retry, logging
│   └── proxy.service.ts    Orchestration: validate → transform → forward
├── transformers/
│   ├── index.ts            transformRequest/transformResponse entry points
│   └── adapters/           One file per provider + PROVIDER_ROUTES registry
├── types/
│   ├── canonical.types.ts  The canonical format
│   ├── canonical.schema.ts Zod schemas for runtime validation
│   └── *.types.ts          Provider types (mostly SDK re-exports)
└── utils/                  logger (pino), error classes
```

## Testing

```bash
npm test
```

~700 tests, all fast, no network. Layers:

- **Adapter unit tests** (`src/transformers/adapters/*.test.ts`) — each
  adapter's to/from canonical functions.
- **Contract tests** (`tests/contracts/`) — the interesting part. Every
  adapter's canonical output is validated against Zod schemas, fixture-driven
  golden tests cover realistic payloads, and wiring tests run all 16 provider
  pairs through the full transform to prove they compose.
- **HTTP integration tests** (`tests/integration/`) — real requests against
  the Express app via supertest, with upstream providers mocked by msw. No
  actual network calls happen. `pairs.test.ts` generates end-to-end tests
  per provider pair — chat and model list, so all 16 combinations get
  exercised twice — and `errors.test.ts` runs every pair through the
  upstream-error mapping table.

The contract tests are what make the adapter approach hold up: you don't need
N×N tests if every adapter produces schema-valid canonical data, because then
any pair composes by construction.

## Live tests

`npm test` never touches the network, so it can't catch upstream-format
drift. The opt-in live suite runs the real app against real upstreams:

```bash
npm run test:live
```

- **Ollama always runs**: `OLLAMA_API_BASE_URL` (default
  `http://localhost:11434`) must be reachable or the suite fails loudly —
  it never silently passes. Model from `LIVE_OLLAMA_MODEL` (default
  `qwen2.5:0.5b`).
- **Paid providers are opt-in**: OpenAI, Anthropic and Gemini cases run
  only when `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` are
  set, with a cheap model from `LIVE_<PROVIDER>_MODEL`. Skipped targets
  are listed in the output.
- Cases per available target, driven through every source format: a chat
  round trip, the model list, an unknown model → 404, and `stream: true`
  → 501 — all asserted on response *shape*, never on generated text.

A nightly GitHub Actions job (`.github/workflows/live.yml`) runs the
suite against a fresh Ollama; paid-provider secrets are off until the
owner adds them.

## Adding a provider

Adding a provider costs one adapter file — see
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-provider).

## Known limitations

- **Streaming returns 501.** `stream: true` in any dialect — and Gemini's
  `:streamGenerateContent` endpoint — is refused before any upstream call
  with `Streaming is not supported yet (planned for v1.1). Send "stream":
  false.` Streaming transforms land in v1.1.
- **Ollama clients get a single JSON reply.** An Ollama-format request
  that omits `stream` is answered non-streaming — unlike Ollama's own
  API, which streams NDJSON by default. Send `"stream": false` explicitly
  to make that intent clear; `"stream": true` gets the 501 above until
  v1.1.
- **Ollama `thinking` output is dropped.** Thinking models (e.g. qwen3)
  emit a `thinking` field the canonical format has no place for, so it
  doesn't reach the client. Surfacing it as reasoning content is planned
  for v1.1.
- Some provider-specific features (tool calls, citations) map to
  canonical best-effort — the format only keeps what's expressible
  across providers.
- One source→target pair per instance. That's a deliberate simplification,
  not an oversight.

## Roadmap

The version-by-version plan — streaming and tools in v1.1, one endpoint
for many providers in v1.2, and beyond — lives in
[docs/roadmap.md](docs/roadmap.md).

## Docker

```bash
docker build -t llm-proxy .
docker run -p 3000:3000 --env-file .env llm-proxy
```

Multi-stage build: provider SDKs are `devDependencies` (type-only imports),
so the runtime image only ships express/pino/zod/dotenv plus `dist/`.

## Stack

Express 5, TypeScript, pino (logging), zod (schema validation), vitest +
msw + supertest (tests). Provider types come from the official SDKs wherever
possible.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Contributions
are welcome: [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and checks,
and first-time contributors sign the [CLA](CLA.md) once via the CLA
Assistant bot on their first PR.
