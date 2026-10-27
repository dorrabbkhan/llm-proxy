# babelgate v1.1 — Design Spec ("Claude Code on anything")

**Date:** 2026-10-27 · **Status:** design approved section by section by the owner on 2026-10-27; this
written spec awaits owner review · **Roadmap:** `docs/roadmap.md` (Phase 1, v1.1) ·
**Parent spec:** `docs/superpowers/specs/2026-10-26-llm-proxy-roadmap-design.md` ·
**Previous version:** `docs/superpowers/specs/2026-10-26-llm-proxy-v1.0.1-design.md`

The project is renamed from `llm-proxy` to **babelgate** in this version (§3.7). This spec uses the new
name; earlier specs, plans and decisions keep the old one as history.

## 1. Purpose

Public launch. A Claude Code user points `ANTHROPIC_BASE_URL` at babelgate and works against a local
Ollama model or a cheaper OpenAI-compatible backend, with streaming and tools, as if it were Anthropic.
An OpenAI-SDK app does the same against Ollama. Both work from one command.

### 1.1 Why this shape
v1.0.1 made non-streaming chat correct. Every agent client streams and calls tools, and today streaming
returns 501 and only the OpenAI adapter handles tools. The roadmap chose "hook first, then broaden":
launch on the Claude Code experience, then harden the rest. The owner chose to run v1.1 as one version
with two milestones (§5): milestone 1 launches on the Claude Code path, and milestone 2 brings every
source × target pair to the same bar. The architecture is identical for both: work is per adapter, never
per pair.

### 1.2 Evidence (read from the code on main, 2026-10-27)
| # | Finding | Where | Effect |
|---|---|---|---|
| F1 | `stream: true` and Gemini `:streamGenerateContent` return 501 | `proxy.service.ts` (v1.0.1 Task 5) | Claude Code, Open WebUI and most SDK apps can't be used |
| F2 | `CanonicalStreamChunk` exists but is unused; its tool deltas have no `index` | `canonical.types.ts:149-169` | It can't carry parallel tool calls or block boundaries |
| F3 | Tools are handled only by the OpenAI adapter; Gemini drops them, Anthropic and Ollama only map the finish reason | adapters | Agent clients fail across most pairs |
| F4 | `CanonicalToolChoice` is defined but unused | `canonical.types.ts:107` | `tool_choice` is silently dropped |
| F5 | No `tool_result` / `is_error` handling for Anthropic; `system` arrays not handled as arrays | `anthropic.adapter.ts` | Claude Code's second turn can't be translated |
| F6 | No `count_tokens` route | `PROVIDER_ROUTES.anthropic` | Claude Code calls it to decide when to compact |
| F7 | Ollama's default context window is far smaller than Claude Code's ~15–25k-token prompt, and Ollama truncates silently | Ollama `options.num_ctx` | The model never sees its tools |
| F8 | The npm name `llm-proxy` belongs to another project (v1.17.0) | npm registry | `npx llm-proxy` can't be ours |

### 1.3 Success criteria
- Milestone 1 (launch, `1.1.0`):
  - Claude Code completes the gate edit task (§4.7) through babelgate on a local `qwen3-coder:30b` and
    through OpenRouter.
  - The launch pairs (§5) pass the streaming × tools matrix; all four adapters' stream decoders and
    encoders pass their contract, SDK-parse and property tests.
  - `npx babelgate --preset claude-code --target ollama --model qwen3-coder:30b` prints the client env
    lines and serves.
- Milestone 2 (`1.1.x`): all 16 pairs pass the streaming × tools matrix; Gemini and Ollama sources pass
  the live suite.
- No existing expected value changes, except where a task names it and the owner approves.

## 2. Scope

### 2.1 In v1.1
1. Rename to babelgate (§3.7).
2. Canonical changes: stream events, `toolChoice`, `isError`, `contextWindow`, decoder/encoder interfaces
   (§3.1).
3. Streaming pipeline and the four stream decoders/encoders (§3.2, §3.3).
4. Tools end to end in all four adapters, streaming and non-streaming (§3.4).
5. Claude Code essentials: `count_tokens`, `MODEL_MAP`, context window, safe handling of `thinking`,
   `cache_control` and unknown blocks (§3.5).
6. One-command install: `npx babelgate` with presets; Docker image on GHCR (§3.6).
7. Tests and gates (§4); launch docs (§3.8).

### 2.2 Not in v1.1
- Several providers per instance, model-name routing, aliases, fallbacks (v1.2). `MODEL_MAP` (§3.5) is the
  only model rewriting in v1.1.
- UI, usage store, cost (v1.3). Embeddings, structured output, reasoning mapping (v1.4).
- `parallel_tool_calls` control, cache-token usage fields, multiple candidates.
- Recovering tool calls that a model writes as plain text.

### 2.3 Non-goals
- Provider-pair special cases. A pair-specific need means the canonical format is missing something; it
  is fixed there.
- Changing any existing timeout or retry default.

## 3. Design

### 3.1 Canonical format changes (interface)
`canonical.types.ts` and `canonical.schema.ts` change together; each item below is logged in
`docs/decisions.md` by the task that adds it.

**Request**
- `toolChoice?: CanonicalToolChoice` on `CanonicalRequest` (the existing type).
- `config.contextWindow?: number` — the minimum context window the target should allocate. Set by the
  proxy from `TARGET_CONTEXT_WINDOW` (§3.5). Only the Ollama adapter uses it (`options.num_ctx`).
- `systemPrompt` stays a string. Adapters whose providers send arrays join text blocks with `"\n\n"`.

**Messages**
- `isError?: boolean` on `CanonicalMessage`, meaningful only for `role: "tool"` (Anthropic `is_error`).
  Adapters whose provider has no equivalent ignore it.
- Tool results stay one canonical `role: "tool"` message per result, with `toolCallId`.

**Streaming** — `CanonicalStreamChunk` and `CanonicalDelta` are removed (unused) and replaced by:
```ts
export type CanonicalStreamEvent =
  | { type: "message_start"; id: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "tool_call_end"; index: number }
  | { type: "usage"; usage: CanonicalUsage }
  | { type: "message_end"; finishReason: CanonicalFinishReason }
  | { type: "error"; error: CanonicalError };
```
Rules every decoder guarantees and every encoder may rely on:
1. Exactly one `message_start` first. Then `message_end` or `error` last, and nothing after it.
2. `tool_call_start(i)` comes before any `tool_call_delta(i)` and before `tool_call_end(i)`. `index`
   values start at 0 and increase by one per call within a message.
3. The concatenated `argumentsDelta` of call `i` is that call's arguments as a JSON string, exactly as
   the provider sent them (not re-serialised).
4. `usage` appears at most once, before `message_end`.
5. Events of different blocks may interleave: text between tool calls, and deltas of different tool-call
   indexes (OpenAI streams several calls at once). Encoders must not assume a call's events are
   contiguous; they key all tool state by `index`.

**Adapter interface** — `ProviderAdapter` gains:
```ts
createStreamDecoder(model: string): StreamDecoder;
createStreamEncoder(ctx: StreamEncoderContext<TRequest>): StreamEncoder;

interface StreamDecoder {
  feed(chunk: Uint8Array | string): CanonicalStreamEvent[];
  end(): CanonicalStreamEvent[]; // flushes; emits `error` if the stream ended early
}
interface StreamEncoder {
  readonly contentType: string;
  encode(event: CanonicalStreamEvent): string;
  end(): string;
}
interface StreamEncoderContext<TRequest> {
  sourceRequest: TRequest;              // the client's own request, in this adapter's own type
  query: Record<string, string>;        // e.g. Gemini `alt=sse`
  requestedModel: string;               // the model name the client asked for (§3.5)
}
```
Decoders and encoders are stateful, one per request, and pure (no I/O, no clock, no randomness except
through an injected ID generator, so tests are deterministic). Each adapter still imports only from
`src/types/` and `src/utils/`.

`ProviderRoute` gains `streamRequestPath?: (model?: string) => string`, used only by Gemini
(`/v1beta/models/<m>:streamGenerateContent?alt=sse`); the others stream on the same path. Task 5 of
v1.0.1's `isStreamPath` stays.

### 3.2 Streaming pipeline
When canonical `stream === true`:
1. **Request.** The source adapter decodes as today. The target adapter's `fromCanonicalRequest` sets its
   own streaming flag; OpenAI also sets `stream_options: { include_usage: true }`.
2. **Upstream.** `http-client.postStream(opts)` resolves when response headers arrive.
   - Non-2xx before any byte: the body is read and goes through v1.0.1's error mapping; the client gets a
     normal error in its own dialect with the mapped HTTP status.
   - Retries: today's policy (transport failures, 429/503), before the first byte only. Never after.
   - `UPSTREAM_TIMEOUT_MS` (unchanged, default 30 s) covers connect + response headers.
   - **New `UPSTREAM_STREAM_IDLE_MS`** (default 300 000): the longest gap allowed between chunks once
     streaming has started. Approved by the owner on 2026-10-27.
3. **Pipe.** upstream bytes → `targetDecoder.feed()` → events → `sourceEncoder.encode()` → `res.write`.
   The pipe honours backpressure (waits for `drain`). Headers are sent once, before the first write:
   the encoder's `contentType`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
4. **Failure mid-stream** (upstream error event, socket drop, idle timeout, undecodable data): the
   decoder or pipeline emits a canonical `error` event; the source encoder writes its provider's in-stream
   error form and the response ends. The client never receives a truncated JSON object followed by
   silence.
5. **Client disconnect.** If the client connection closes before `message_end`, an `AbortController`
   cancels the upstream request.
6. **Logging.** On `message_end` the same completion line as non-streaming (token usage, finish reason,
   latency) plus `stream: true`. Chunk contents are never logged.

### 3.3 Wire protocols (each task confirms these against the provider's current docs and records the source)
| Provider | Stream format | Decoder | Encoder |
|---|---|---|---|
| OpenAI | SSE `data: {chat.completion.chunk}` … `data: [DONE]` | `delta.tool_calls[k]` → start (first piece with `id`/`name`), deltas (`function.arguments`); usage chunk with empty `choices` | usage chunk only if `sourceRequest.stream_options.include_usage`; ends with `data: [DONE]`; error: `data: {"error":{…}}` then end |
| Anthropic | Event-typed SSE: `message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`, `ping`, `error` | `text_delta` → text; `tool_use` block + `input_json_delta.partial_json` → tool events; `thinking`/`signature` deltas dropped; input tokens from `message_start`, output from `message_delta` | Tool arguments are **buffered until `tool_call_end`**, validated, then sent as one `input_json_delta` (§3.4); error: `event: error` |
| Gemini | `alt=sse` → `data: {GenerateContentResponse}`; without `alt=sse` a streamed JSON array | `functionCall` parts arrive whole → start + one delta (`JSON.stringify(args)`) + end; `usageMetadata` on the last chunk | Both forms, chosen by `ctx.query.alt`; error: an `{"error":{…}}` element |
| Ollama | NDJSON; the final line has `done: true`, `done_reason`, `prompt_eval_count`, `eval_count` | `message.tool_calls` arrive whole, with arguments as an object → start + one delta + end | NDJSON lines; error: a `{"error":"…"}` line |

### 3.4 Tools end to end
| | Definitions | `toolChoice` | Calls in the reply | Results sent back |
|---|---|---|---|---|
| OpenAI | `tools[].function` | `tool_choice` | `tool_calls[]` (id, JSON string) | `role: "tool"`, `tool_call_id` |
| Anthropic | `tools[]` with `input_schema` | `auto` / `any` / `tool` / `none` | `tool_use` blocks (id, `input` object) | `tool_result` blocks in a user message, `is_error` |
| Gemini | `tools[].functionDeclarations` | `toolConfig.functionCallingConfig` (`AUTO` / `ANY` + `allowedFunctionNames` / `NONE`) | `functionCall` parts (args object; `id` used when present, otherwise generated) | `functionResponse` parts; name found from the matching assistant call in the same request; a string result is wrapped as `{ "content": "<string>" }` |
| Ollama | OpenAI-style `tools` | none: `auto` passes, anything else → 400 `invalid_request` | `message.tool_calls` (args object; IDs generated) | `role: "tool"` (+ `tool_name`) |

Rules:
- **Anthropic messages.** `toCanonicalRequest` splits a user message with N `tool_result` blocks into N
  canonical tool messages (in order), followed by a user message for any remaining text or image blocks.
  `fromCanonicalRequest` merges consecutive tool messages into one user message of `tool_result` blocks.
  An assistant message's text comes before its tool calls when encoding.
- **Generated IDs.** Where a provider has no call ID, the adapter generates `call_<n>` via its injected
  generator, unique within the response. When encoding a request to such a provider, the ID is dropped
  and the name is looked up from history.
- **Gemini schemas.** One function, `toGeminiSchema(schema)`, keeps only the keywords in Google's
  documented schema subset and drops the rest (e.g. `$schema`, `additionalProperties`, `default`). The
  task records the allow-list and its source. Other adapters pass schemas through unchanged.
- **Invalid arguments.** Canonical arguments are a JSON string as received. Encoders that need an object
  (Anthropic `input`, Gemini `args`, Ollama `arguments`) parse it; on failure they send
  `{ "_invalid_arguments": "<raw string>" }`, and log a warn line without the arguments.
- **Capability errors.** An upstream "model does not support tools" is mapped by v1.0.1's error policy (a
  400 in the source dialect). No pre-check.

### 3.5 Claude Code essentials
- **Routes.** `POST /v1/messages` (any query, e.g. `?beta=true`) and `POST /v1/messages/count_tokens` on
  the Anthropic source. `anthropic-version` and `anthropic-beta` headers are accepted and ignored.
- **`count_tokens`.** Answered locally, never upstream: `ceil(chars / 4)` over the system prompt, message
  text, tool-call arguments, tool results and tool definitions (JSON), as `{ "input_tokens": N }`, with
  the response header `x-babelgate-token-estimate: true`. Other sources: not served (404, as today for
  unknown paths).
- **Dropped safely** (debug log with the type name only): `thinking` and `redacted_thinking` blocks in
  input, the `thinking` request parameter, `cache_control` anywhere, `metadata`, and thinking deltas in
  streams.
- **Unknown content-block types** → 400 `invalid_request` in the source dialect, naming the type.
- **`MODEL_MAP`** (env): ordered `glob=model` rules separated by commas, e.g.
  `MODEL_MAP="claude-*haiku*=qwen2.5-coder:7b,claude-*=qwen3-coder:30b"`. Applied to the canonical model
  after decoding, for every source; the first match wins; no match leaves the model unchanged. Replies
  carry the name the client asked for: `proxy.service` sets the canonical response's `model` back to it
  before `fromCanonicalResponse`, and stream encoders use `ctx.requestedModel` instead of
  `message_start.model`. Logs show both. Invalid syntax fails at startup with a clear configuration
  error.
- **`TARGET_CONTEXT_WINDOW`** (env, optional integer) → `config.contextWindow` → Ollama `options.num_ctx`.

### 3.6 Install and presets
- `package.json` gains `"bin": { "babelgate": "dist/cli.js" }` and a `files` list. `src/cli.ts` parses
  arguments with `node:util` `parseArgs` (no new dependency), sets env defaults that the user's own env
  overrides, starts the server, and prints the client lines to paste.
- Flags: `--preset <claude-code|openai-apps>`, `--target <ollama|openai|anthropic|gemini>`,
  `--model <name>`, `--base-url <url>`, `--port <n>`, `--help`. Upstream keys come only from the
  environment, never from flags.
- `claude-code`: source `anthropic`; `MODEL_MAP=claude-*=<model>`; `TARGET_CONTEXT_WINDOW=32768`; for
  target `ollama`, `UPSTREAM_TIMEOUT_MS=600000` (a preset value, not a default change). Prints
  `export ANTHROPIC_BASE_URL=http://localhost:<port>` and `export ANTHROPIC_AUTH_TOKEN=<PROXY_API_KEY or
  "babelgate">`.
- `openai-apps`: source `openai`; prints `export OPENAI_BASE_URL=http://localhost:<port>/v1` and
  `export OPENAI_API_KEY=<PROXY_API_KEY or "babelgate">`.
- `.github/workflows/release.yml`: on a pushed `v*` tag only, build and push
  `ghcr.io/dorrabbkhan/babelgate:<version>` and `:latest`. npm publishing stays a manual owner step.

### 3.7 Rename to babelgate
- In the repo: `package.json` name, README, `CONTRIBUTING.md`, `SECURITY.md`, templates, `NOTICE`,
  `CLA.md` (project name and URL only), the CLA workflow's `path-to-document` URL, the Docker image name,
  logger/service names, the `x-babelgate-*` header prefix, and `docs/roadmap.md`.
- Unchanged: git history; past specs, plans and decisions (a one-line note at the top of
  `docs/decisions.md` says the project was renamed).
- Owner: rename the GitHub repo (GitHub redirects the old URL), reserve the npm name.

### 3.8 Launch docs
README: the 30-second Claude Code + Ollama quick-start, the OpenRouter variant, the OpenAI-app variant, a
demo GIF, recommended tool-capable models, and known limitations. `docs/recipes/claude-code.md` and
`docs/recipes/openai-sdk.md`. CHANGELOG `1.1.0`.

## 4. Testing
1. **Stream fixture corpus.** `tests/fixtures/streams/<provider>/<case>.{sse,ndjson}` with raw bytes, plus
   `<case>.json` holding the non-streaming twin where one exists. Cases per provider: text, one tool
   call, parallel tool calls, tool-result follow-up, max-tokens stop, mid-stream error. Ollama recorded
   live with `npm run record:streams` (opt-in, network); OpenAI, Anthropic and Gemini from the providers'
   documented examples verbatim, or owner-recorded. Each fixture names its source and date. New fixture
   files are committed separately for owner approval.
2. **Decoder contract tests.** Fixture bytes → the exact expected event list, including fed in
   arbitrary chunk splits (every split point, for short fixtures).
3. **Encoder SDK-parse tests.** Encoder output is served through msw and parsed by the provider's own SDK
   (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `ollama`, already devDependencies). The
   SDK's stream helper must yield the expected final message, including tool calls with parseable
   input.
4. **Property tests** (seeded generator, no new dependency): (a) reassembling a decoded stream equals
   `toCanonicalResponse` of its non-streaming twin; (b) `decode(encode(events))` deep-equals `events`.
5. **Pair matrix.** Generated over source × target × {text, tool call, parallel calls, tool-result round
   trip} × {stream, non-stream}. Milestone 1 requires the launch pairs (§5); milestone 2 requires all 16.
6. **Live suite.** Nightly: streaming text on `qwen2.5:0.5b`, and tool definitions accepted with a
   well-formed reply (tool calls not asserted on a 0.5B model). With `OPENROUTER_API_KEY`: the same plus
   a forced tool call. No network in `npm test`.
7. **Claude Code gate** — `scripts/gates/claude-code-edit.sh <target>`: copies a small fixture project
   with one failing test to a temp dir, starts babelgate with the `claude-code` preset, runs Claude Code
   non-interactively with the instruction to make the test pass, and then runs the test. Pass = the test
   passes. It records the Claude Code version, the model and the duration. Targets: local
   `qwen3-coder:30b`, and OpenRouter.

## 5. Milestones and task outline (the plan will detail these)
**Launch pairs (milestone 1):** anthropic → ollama, anthropic → openai (any OpenAI-compatible backend),
openai → ollama. All four adapters still get decoders, encoders and tools in milestone 1; only the
matrix requirement is narrowed.

| # | Task | Gate |
|---|---|---|
| 1 | Rename to babelgate | OWNER GATE |
| 2 | Canonical changes and interfaces (§3.1) | interface |
| 3 | Stream fixture corpus | new fixtures |
| 4 | `postStream` + streaming pipeline, with the OpenAI decoder/encoder | |
| 5 | Anthropic decoder/encoder | |
| 6 | Ollama decoder/encoder | |
| 7 | Gemini decoder/encoder | |
| 8 | Tools: OpenAI + Ollama | |
| 9 | Tools: Anthropic | |
| 10 | Tools: Gemini | |
| 11 | Claude Code essentials (§3.5) | |
| 12 | Property tests + launch-pair matrix | |
| 13 | CLI + presets | OWNER GATE (`bin`, `files`) |
| 14 | GHCR release workflow | OWNER GATE |
| 15 | Live suite (streaming, tools) + Claude Code gate script; gate run | OWNER REVIEW |
| 16 | README, recipes, CHANGELOG, `1.1.0` | OWNER GATE |
| 17 | Milestone 2: full 16-pair matrix, fixes inside adapters | |
| 18 | Milestone 2: Gemini and Ollama sources live; `1.1.x` | |

## 6. Owner decisions (2026-10-27)
| # | Decision | Chosen |
|---|---|---|
| D1 | Shape | One version, two milestones; launch on the Claude Code path |
| D2 | Name | babelgate (npm, GitHub user/org and repo names free on 2026-10-27) |
| D3 | Release gate | Local `qwen3-coder:30b` for correctness; OpenRouter for speed and the demo |
| D4 | Streaming architecture | Event-based canonical stream with per-adapter stateful decoders/encoders |
| D5 | New default | `UPSTREAM_STREAM_IDLE_MS` = 300 000 |

**Owner actions:** reserve the npm name `babelgate` now (a `0.0.0` placeholder); pull `qwen3-coder:30b`;
create an OpenRouter key and add it as `OPENROUTER_API_KEY` before Task 15; rename the GitHub repo during
Task 1; approve fixture batches and gated PRs; tag `v1.1.0`, publish to npm, launch posts and the Ollama
community-integrations listing.

## 7. Risks
| Risk | Mitigation |
|---|---|
| Local models call tools unreliably | Tool calls asserted only on `qwen3-coder:30b` and OpenRouter; README recommends tool-capable models |
| CPU is slow on Claude Code's prompt | Idle timeout, preset timeout, two-part gate |
| Claude Code changes its protocol | Gate records the Claude Code version; unknown blocks fail loudly |
| Gemini schema/tool quirks | One schema function; Gemini is not a launch pair |
| Streamed tool calls into Anthropic clients break on bad JSON | Anthropic encoder buffers and validates tool arguments |
| The name is taken before launch | Owner reserves it now |
| Scope creep | §2.2 stands; anything else is a follow-up |
