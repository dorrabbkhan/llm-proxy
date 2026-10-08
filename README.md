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

Routing and upstream endpoints are conventions, not configuration: each
provider's `pathPrefix` and `requestPath` live in `PROVIDER_PATHS` in
`src/transformers/adapters/index.ts`. There used to be a YAML mappings file
here — it got deleted because it only ever repeated these conventions.

## Project structure

```
src/
├── app.ts                  Express app wiring (middleware → routes → errors)
├── index.ts                Server startup
├── config/env-config.ts    Env var config (lazy, validated)
├── middleware/             pino request logging, error handler
├── routes/proxy.ts         The actual proxy handler
├── transformers/
│   ├── index.ts            transformRequest/transformResponse entry points
│   └── adapters/           One file per provider + PROVIDER_PATHS registry
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

~260 tests, all fast. Layers:

- **Adapter unit tests** (`src/transformers/adapters/*.test.ts`) — each
  adapter's to/from canonical functions.
- **Contract tests** (`tests/contracts/`) — the interesting part. Every
  adapter's canonical output is validated against Zod schemas, fixture-driven
  golden tests cover realistic payloads, and wiring tests run all 16 provider
  pairs through the full transform to prove they compose.
- **HTTP integration tests** (`tests/integration/`) — real requests against
  the Express app via supertest, with upstream providers mocked by msw. No
  actual network calls happen. `pairs.test.ts` generates one end-to-end test
  per provider pair, so all 16 combinations get exercised.

The contract tests are what make the adapter approach hold up: you don't need
N×N tests if every adapter produces schema-valid canonical data, because then
any pair composes by construction.

## Adding a provider

1. Create `src/transformers/adapters/newprovider.adapter.ts` implementing the
   `ProviderAdapter` interface (`toCanonicalRequest`, `fromCanonicalRequest`,
   `toCanonicalResponse`, `fromCanonicalResponse`).
2. Register it in `adapters` and add its `pathPrefix`/`requestPath` to
   `PROVIDER_PATHS` in `src/transformers/adapters/index.ts`.
3. Add it to `VALID_PROVIDERS` in `src/config/env-config.ts` and extend
   `environment.d.ts` with its `*_API_KEY` / `*_API_BASE_URL` vars.
4. Add fixtures in `tests/fixtures/` — the contract and pair tests pick them
   up automatically and will tell you if the canonical output is wrong.

## Known limitations

- **Streaming isn't transformed.** Requests with `stream: true` are passed
  through the transforms but the SSE responses aren't converted between
  formats yet. It's on the list.
- Some provider-specific features (tool calls, citations, provider-specific
  error shapes) map to canonical best-effort — the format only keeps what's
  expressible across providers.
- One source→target pair per instance. That's a deliberate simplification,
  not an oversight.

## Stack

Express 5, TypeScript, pino (logging), zod (schema validation), vitest +
msw + supertest (tests). Provider types come from the official SDKs wherever
possible.
