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
# fill in .env — see Configuration below

npm run dev
```

Then send an OpenAI-style request at the proxy:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3", "messages": [{"role": "user", "content": "Hello"}]}'
```

With `TARGET_API=ollama` configured, that gets translated to an Ollama
`/api/chat` call upstream, and the response comes back in OpenAI
`chat.completion` shape.

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
| `PROXY_API_KEY`           | Optional client auth — when set, callers send `Authorization: Bearer <key>`                  |

Routing and upstream endpoints are conventions, not configuration: each
provider's routes (`kind`, `method`, `pathPrefix`, `requestPath`) live in
`PROVIDER_ROUTES` in `src/transformers/adapters/index.ts`. There used to be
a YAML mappings file here — it got deleted because it only ever repeated
these conventions.

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

~315 tests, all fast. Layers:

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
  exercised twice.

The contract tests are what make the adapter approach hold up: you don't need
N×N tests if every adapter produces schema-valid canonical data, because then
any pair composes by construction.

## Adding a provider

Adding a provider costs one adapter file — see
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-provider).

## Known limitations

- **Streaming isn't transformed.** Requests with `stream: true` are passed
  through the transforms but the SSE responses aren't converted between
  formats yet. It's on the list.
- Some provider-specific features (tool calls, citations, provider-specific
  error shapes) map to canonical best-effort — the format only keeps what's
  expressible across providers.
- One source→target pair per instance. That's a deliberate simplification,
  not an oversight.

## TODO / future features

Roughly in priority order:

- **Streaming transforms.** Canonical stream chunks already exist
  (`CanonicalStreamChunk`) — need SSE piping per adapter pair. The highest
  value missing feature.
- **Embeddings endpoint.** `/v1/embeddings` ↔ Gemini `embedContent` ↔
  Ollama `/api/embed`. Needs a second canonical pair plus a `501
NOT_SUPPORTED` pattern, since Anthropic has no embeddings API.
- **Prove the recipe with a 5th provider.** Qwen/DashScope native adapter —
  validates the "adding a provider costs one file" promise and exercises
  the fixture-driven test machinery.
- **Multiple source→target pairs per instance.** Path- or
  header-based routing instead of the single SOURCE_API/TARGET_API pair.
- **Rate limiting + CORS/helmet.** Deliberately omitted so far — add when
  the proxy is exposed beyond a trusted network (client auth via
  `PROXY_API_KEY` already covers the basic case).
- **Per-request metrics.** Token usage is logged per request; aggregating
  into counters/histograms (e.g. Prometheus `/metrics`) is a natural next
  step.

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
