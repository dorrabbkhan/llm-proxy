# babelgate v1.1 ("Claude Code on anything") Implementation Plan

> **For agentic workers (Devin):** Run each task in its own session with `/babelgate-task v1.1 <N>`. One task → one branch (`v1.1/task-<N>-<short-name>`) → one PR. Steps use checkbox (`- [ ]`) syntax. Read `AGENTS.md`, this plan's Global Constraints and Review Focus, and the spec sections each task names. Use `./scripts/check.sh quick` while iterating and `./scripts/check.sh` before pushing. Verify every write with `git diff`. (The product is renamed in Task 1.)

**Goal:** Launch: Claude Code (Anthropic format) and OpenAI-SDK apps work against Ollama and OpenAI-compatible backends with streaming and tools, from one `npx babelgate` command.

**Architecture:** Streaming flows as a typed sequence of `CanonicalStreamEvent`s. Each adapter gets a stateful stream decoder (its provider's bytes → events) and encoder (events → its provider's bytes); a provider-agnostic pipeline connects target decoder to source encoder with abort, idle timeout and in-stream errors. Tools are mapped per adapter through the existing canonical tool types plus `toolChoice` and `isError`.

**Tech Stack:** As v1.0.1 (Node ≥ 20, TypeScript 5 strict, Express 5, Zod 4, pino, vitest 3, msw 2, supertest). The provider SDKs already in devDependencies (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `ollama`) are used as stream parsers in tests. Added: none.

**Spec:** `docs/superpowers/specs/2026-10-27-babelgate-v1.1-design.md`. Parent: `docs/superpowers/specs/2026-10-26-babelgate-roadmap-design.md`.

**Decided with the owner (2026-10-27), reflected in the spec §6:** D1 one version, two milestones (launch on the Claude Code path); D2 name babelgate; D3 release gate on local `qwen3-coder:30b` plus OpenRouter; D4 event-based canonical stream; D5 `UPSTREAM_STREAM_IDLE_MS` default 300 000.

**Prerequisite (owner):** merge the spec PR (#11) and this plan before Task 1. npm name `babelgate` reserved (done 2026-10-27).

## Global Constraints

- **No existing expected value changes** unless a task names it. Existing fixtures and contract snapshots are never edited; new fixture files are allowed and are committed separately for owner approval.
- **The one named exception:** v1.0.1's `"<source> stream:true → 501 …"` and `"gemini :streamGenerateContent → 501, no upstream call"` cases in `tests/integration/errors.test.ts`. Each of Tasks 4–7 replaces exactly the cases for the pairs it enables (both adapters stream) with streaming assertions, listing each one old → new in its PR (spec §1.2 F1: 501 → 200 by design). `"gemini non-chat methods → 501"` never changes.
- **No existing default changes.** `UPSTREAM_TIMEOUT_MS` stays 30 000 and `UPSTREAM_RETRIES` stays 1. The only new default is `UPSTREAM_STREAM_IDLE_MS` = 300 000. Presets set values; they don't change defaults.
- **Adapters stay independent.** `<provider>.adapter.ts` and its own helper files (`<provider>.stream.ts`, `gemini.schema.ts`) import only from `src/types/`, `src/utils/` and each other within the same provider. No adapter imports another provider's files. No provider-pair branches anywhere.
- **Canonical changes are exactly** (spec §3.1): `CanonicalRequest.toolChoice`, `CanonicalConfig.contextWindow`, `CanonicalMessage.isError`, `CanonicalStreamEvent` (replacing `CanonicalStreamChunk`/`CanonicalDelta`), `StreamDecoder`, `StreamEncoder`, `StreamEncoderContext`, `IdGenerator`, and `ProviderAdapter.createStreamDecoder` / `createStreamEncoder` plus the optional `ids` parameter on `toCanonicalResponse`. Data types are mirrored in `canonical.schema.ts`.
- **Stream event rules** (spec §3.1, verbatim): one `message_start` first; `message_end` or `error` last and nothing after; `tool_call_start(i)` before any `tool_call_delta(i)` / `tool_call_end(i)`; `index` from 0, +1 per call; concatenated `argumentsDelta` is the provider's JSON string as sent; `usage` at most once, before `message_end`; encoders key tool state by `index` and never assume contiguity.
- **Copy, verbatim:** count-tokens header `x-babelgate-token-estimate: true`; invalid-arguments wrapper `{ "_invalid_arguments": "<raw string>" }`; Gemini string tool result wrapper `{ "content": "<string>" }`; generated tool-call IDs `call_<n>`-style via `IdGenerator`.
- **Privacy:** no prompt text, completion text, tool arguments, tool results or keys in any log line or error message. Stream chunks are never logged. Dropped Claude Code blocks are logged at debug with the type name only.
- **No network in `npm test`.** Real upstreams only in `tests/live/` (`npm run test:live`) and in `scripts/` tools that say so.
- **No new runtime or dev dependencies.** CLI arguments via `node:util` `parseArgs`.
- **Owner-only:** fixture/snapshot changes to existing files, approving new fixture batches, `package.json` publishing fields (`bin`, `files`), the release workflow, renaming the GitHub repo, adding secrets, publishing to npm/GHCR, tagging, merging.

## Review Focus

1. **Chunk boundaries anywhere:** an SSE event, an NDJSON line or a multi-byte UTF-8 character split across network chunks, several events in one chunk, `\r\n` line endings. Expected: identical events whatever the split. → Task 2 (`utf8 split mid-character`, `sse every split point`), and each decoder task (`decodes identically at every split point`).
2. **Upstream stream ends early** (socket closed with no `[DONE]` / `message_stop` / `done: true`). Expected: the client gets its provider's in-stream error, never silence or half a JSON object. → Tasks 4–7 (`truncated stream ends with an error event`), Task 4 (`truncated upstream → client receives in-stream error`).
3. **Client disconnects mid-stream.** Expected: the upstream request is aborted, no write after end, no unhandled rejection. → Task 4 (`client disconnect aborts upstream`).
4. **Upstream rejects a stream request before any byte** (404 unknown model, 429 with `Retry-After`, 401). Expected: a normal JSON error in the source dialect with the mapped status, exactly as non-streaming. → Task 4 (`stream request upstream 404 → JSON error in source dialect`).
5. **Tool-call edge shapes:** empty arguments (`""`), `{}`, parallel calls whose deltas interleave (index 1 before index 0 finishes), arguments that aren't JSON. Expected: Anthropic/Gemini/Ollama clients get valid objects (`{}` for empty, the `_invalid_arguments` wrapper for invalid), each call keeps its own ID. → Task 5 (`interleaved parallel calls`, `empty arguments become {}`), Task 2 (`parseToolArguments`).

Each line is pinned by a named test in the owning task.

---

## File Map

```
package.json, README.md, NOTICE, CLA.md, CONTRIBUTING.md, SECURITY.md, .github/**, Dockerfile, docs/roadmap.md   rename (T1)
src/types/canonical.types.ts          stream events, StreamDecoder/Encoder, IdGenerator, toolChoice, isError, contextWindow (T2)
src/types/canonical.schema.ts         schemas for the above (T2)
src/utils/sse.ts                      NEW: createUtf8Decoder, createSseParser, formatSse, createLineSplitter (T2)
src/utils/ids.ts                      NEW: createIdGenerator, sequentialIds (T2)
src/utils/stream-reassemble.ts        NEW: reassembleStream (T2)
src/utils/tool-args.ts                NEW: parseToolArguments (T2)
src/utils/model-map.ts                NEW: parseModelMap, applyModelMap (T11)
src/transformers/adapters/<p>.stream.ts   NEW per provider: createStreamDecoder/createStreamEncoder (T4–T7)
src/transformers/adapters/<p>.adapter.ts  tools (T8–T10), Claude Code handling (T11)
src/transformers/adapters/gemini.schema.ts NEW: toGeminiSchema (T10)
src/transformers/adapters/index.ts    streamRequestPath, RouteKind "count_tokens" (T4, T7, T11)
src/services/http-client.ts           postStream (T4)
src/services/stream-pipeline.ts       NEW: runStreamPipeline (T4)
src/services/proxy.service.ts         stream branch, model map, context window, count_tokens (T4, T11)
src/services/token-estimate.ts        NEW: estimateInputTokens (T11)
src/routes/proxy.ts                   write streams, abort on close, query (T4)
src/config/env-config.ts              upstreamStreamIdleMs (T4), modelMap, targetContextWindow (T11)
src/cli.ts                            NEW: CLI + presets (T13)
tests/fixtures/streams/<p>/<case>.{sse,ndjson,json}   NEW corpus (T3)
scripts/record-streams.ts             NEW: records Ollama fixtures (T3)
tests/mocks/upstreams.ts              stream handlers (T4)
tests/contracts/stream-*.test.ts      decoder, SDK-parse, property tests (T4–T7, T12)
tests/integration/stream-pairs.test.ts NEW (T12, T17)
tests/live/stream.live.test.ts        NEW (T15)
scripts/gates/claude-code-edit.sh, scripts/gates/fixtures/edit-task/**   NEW (T15)
.github/workflows/release.yml         NEW (T14)
docs/recipes/{claude-code,openai-sdk}.md, CHANGELOG.md   (T16)
```

## Task Index

| # | Task | Depends on | Gate |
|---|---|---|---|
| 1 | Rename to babelgate | — | OWNER GATE |
| 2 | Canonical stream types, interfaces and stream utilities | 1 | interface |
| 3 | Stream fixture corpus | 2 | new fixtures |
| 4 | `postStream`, pipeline, route, OpenAI decoder/encoder | 3 | |
| 5 | Anthropic decoder/encoder | 4 | |
| 6 | Ollama decoder/encoder | 4 | |
| 7 | Gemini decoder/encoder | 4 | |
| 8 | Tools: OpenAI + Ollama | 2 | |
| 9 | Tools: Anthropic | 2 | |
| 10 | Tools: Gemini | 2 | |
| 11 | Claude Code essentials | 4, 6, 9 | |
| 12 | Property tests + launch-pair matrix | 5, 6, 7, 8, 9, 10, 11 | |
| 13 | CLI + presets | 11 | OWNER GATE |
| 14 | GHCR release workflow | 1 | OWNER GATE |
| 15 | Live streaming/tools + Claude Code gate; gate run | 12, 13 | OWNER REVIEW |
| 16 | README, recipes, CHANGELOG, `1.1.0` | 15 | OWNER GATE |
| 17 | M2: full 16-pair streaming × tools matrix | 16 | |
| 18 | M2: Gemini and Ollama sources live; `1.1.1` | 17 | OWNER GATE |

Tasks 5, 6, 7 run in parallel after 4; Tasks 8, 9, 10 can start right after 2 and in parallel with 3–7. Task 14 can start any time after 1.

---

### Task 1: Rename to babelgate · OWNER GATE

Spec §3.7, D2. PR title starts `[OWNER GATE]`.

**Files:**
- Modify: `package.json` (`name`, `repository`, `bugs`, `homepage`, `description`), `package-lock.json` (root name only), `README.md`, `NOTICE`, `CLA.md` (project name and URL only), `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/*.yml`, `.github/workflows/cla.yml` (`path-to-document` URL → `github.com/dorrabbkhan/babelgate`), `docs/roadmap.md`, `src/transformers/adapters/openai.adapter.ts:428` (`owned_by` fallback `"babelgate"`), `docs/decisions.md`
- Not renamed (agent tooling, kept for v1.1): `.devin/skills/**`, `.claude/commands/**`, `scripts/llm-proxy-loop.sh`, `scripts/conductor/**`, `CLAUDE.md`, `AGENTS.md`, `CONDUCTOR-SETUP.md`, past specs/plans/decisions.

- [ ] **Step 1:** Test: in `src/transformers/adapters/openai.adapter.test.ts` add `"model list owned_by defaults to babelgate"` → `fromCanonicalModelList({ models: [{ id: "m" }] }).data[0].owned_by === "babelgate"`. Run → FAIL.
- [ ] **Step 2:** Apply the renames above. URLs become `https://github.com/dorrabbkhan/babelgate`. Run `git grep -n llm-proxy -- ':!docs/superpowers' ':!docs/decisions.md' ':!.devin' ':!.claude' ':!scripts' ':!CLAUDE.md' ':!AGENTS.md' ':!CONDUCTOR-SETUP.md' ':!package-lock.json'` → only the live test's `does-not-exist-llm-proxy` model name remains (unchanged, it's test data).
- [ ] **Step 3:** `docs/decisions.md`: a note at the top ("Renamed llm-proxy → babelgate in v1.1; older entries keep the old name") and a "v1.1 Task 1" entry listing the `owned_by` wire change and the agent-tooling exclusion. No "Owner sign-off" line.
- [ ] **Step 4:** `./scripts/check.sh` → PASS. List the owner's steps in the PR: `gh repo rename babelgate`, then `git remote set-url origin git@github.com:dorrabbkhan/babelgate.git`. **Commit** `chore: rename the project to babelgate`.

### Task 2: Canonical stream types, interfaces and stream utilities

Spec §3.1, §3.4 (invalid arguments). Canonical interface change.

**Files:**
- Modify: `src/types/canonical.types.ts`, `src/types/canonical.schema.ts`, all four `src/transformers/adapters/*.adapter.ts` (stubs only), `docs/decisions.md`
- Create: `src/utils/sse.ts`, `src/utils/ids.ts`, `src/utils/stream-reassemble.ts`, `src/utils/tool-args.ts`
- Test: `tests/contracts/canonical.schema.test.ts` (new cases), `src/utils/sse.test.ts`, `src/utils/ids.test.ts`, `src/utils/stream-reassemble.test.ts`, `src/utils/tool-args.test.ts`

**Interfaces:**
- Produces (types, exactly as spec §3.1): `CanonicalStreamEvent`; `StreamDecoder { feed(chunk: Uint8Array | string): CanonicalStreamEvent[]; end(): CanonicalStreamEvent[] }`; `StreamEncoder { readonly contentType: string; encode(event: CanonicalStreamEvent): string; end(): string }`; `StreamEncoderContext<TRequest> { sourceRequest: TRequest; query: Record<string, string>; requestedModel: string }`; `type IdGenerator = () => string`; `CanonicalRequest.toolChoice?: CanonicalToolChoice`; `CanonicalConfig.contextWindow?: number`; `CanonicalMessage.isError?: boolean`.
- Produces (adapter interface): `createStreamDecoder(model: string, ids?: IdGenerator): StreamDecoder`; `createStreamEncoder(ctx: StreamEncoderContext<TRequest>): StreamEncoder`; `toCanonicalResponse(response: TResponse, model: string, ids?: IdGenerator): CanonicalResponse`.
- Produces (schemas): `canonicalStreamEventSchema`; `toolChoice`, `contextWindow`, `isError` in the existing schemas.
- Produces (utils):
  - `sse.ts`: `createUtf8Decoder(): (chunk: Uint8Array | string) => string` (streaming `TextDecoder`); `interface SseEvent { event?: string; data: string }`; `createSseParser(): { feed(text: string): SseEvent[]; end(): SseEvent[] }` (handles `\n`/`\r\n`, multi-line `data:`, comments `:`, ignores `id:`/`retry:`); `formatSse(data: string, event?: string): string`; `createLineSplitter(): { feed(text: string): string[]; end(): string[] }` (non-empty lines).
  - `ids.ts`: `createIdGenerator(prefix?: string): IdGenerator` (default prefix `call_`, random suffix); `sequentialIds(prefix?: string): IdGenerator` (`call_0`, `call_1`, …).
  - `stream-reassemble.ts`: `reassembleStream(events: CanonicalStreamEvent[]): CanonicalResponse` (throws if the events break the rules; an `error` event → throws a `ProxyError` built from it).
  - `tool-args.ts`: `parseToolArguments(json: string): { args: Record<string, unknown>; valid: boolean }` — `""` → `{ args: {}, valid: true }`; a JSON object → itself; anything else → `{ args: { _invalid_arguments: json }, valid: false }`.

- [ ] **Step 1: Tests.**
  - `sse.test.ts`: `"utf8 split mid-character"` — `"é😀"` bytes fed one byte at a time → concatenated output `"é😀"`; `"sse every split point"` — for `'event: a\ndata: {"x":1}\n\ndata: two\ndata: lines\r\n\r\n'`, splitting at every index gives `[{event:"a",data:'{"x":1}'},{data:"two\nlines"}]`; `"sse ignores comments"`; `"line splitter keeps a trailing partial line until end()"`.
  - `tool-args.test.ts`: `""` → `{}` valid; `'{"a":1}'` → `{a:1}` valid; `'[1]'`, `'not json'`, `'{"a":'` → wrapper, invalid.
  - `stream-reassemble.test.ts`: text + two interleaved tool calls (deltas of index 1 before index 0's end) + usage + `message_end("tool_call")` → a `CanonicalResponse` with content, `toolCalls` in index order, usage, finishReason; `"rejects a delta before its start"`; `"an error event throws"`.
  - `canonical.schema.test.ts`: every `CanonicalStreamEvent` variant parses; `{ type: "tool_call_delta", index: -1, … }` fails; `toolChoice` variants parse.
- [ ] **Step 2: Run** → FAIL (modules missing).
- [ ] **Step 3: Implement** the types, schemas and utils. In each adapter add `createStreamDecoder`/`createStreamEncoder` stubs that throw `NotSupportedError` with the existing streaming message, so the interface compiles. `CanonicalStreamChunk` and `CanonicalDelta` are deleted (no users).
- [ ] **Step 4: Run** `./scripts/check.sh quick` → PASS; existing snapshots unchanged. **Record** the canonical changes in `docs/decisions.md` ("v1.1 Task 2"). **Commit** `feat: canonical stream events and stream utilities`.

### Task 3: Stream fixture corpus · new fixtures

Spec §4.1, §3.3.

**Files:**
- Create: `tests/fixtures/streams/{openai,anthropic,gemini,ollama}/<case>.{sse|ndjson}` and `<case>.json`, `scripts/record-streams.ts`, `tests/contracts/stream-fixtures.test.ts`
- Modify: `package.json` (script `record:streams`), `docs/decisions.md`

**Interfaces:**
- Produces: for each case, `<case>.sse` (OpenAI, Anthropic, Gemini `alt=sse`) or `<case>.ndjson` (Ollama) holding raw wire bytes, and `<case>.json`:
  `{ "source": "<doc URL or 'recorded: ollama <version>, <model>'>", "date": "YYYY-MM-DD", "model": string, "expectedEvents": CanonicalStreamEvent[], "nonStreaming": <provider response body> | null }`.
  `expectedEvents` uses `sequentialIds()` for generated IDs. Cases: `text`, `tool_call`, `parallel_tool_calls`, `after_tool_result`, `max_tokens`, `error` (only where the provider documents an in-stream error; omissions listed in decisions.md).
- Produces: `npm run record:streams` (Ollama only; requires `OLLAMA_API_BASE_URL` reachable and a tool-capable model in `RECORD_OLLAMA_MODEL`, default `qwen2.5:7b`) writes `.ndjson` and `nonStreaming` twins.

- [ ] **Step 1: Test** `stream-fixtures.test.ts`: for every `<case>.json`, `"<provider>/<case> fixture is well-formed"` — the wire file exists; `source` and `date` are non-empty; every `expectedEvents` entry passes `canonicalStreamEventSchema`; `reassembleStream(expectedEvents)` doesn't throw (except the `error` case, which must end in an `error` event); when `nonStreaming` is set, `reassembleStream(expectedEvents)` deep-equals `adapters[p].toCanonicalResponse(nonStreaming, model, sequentialIds())` on `message`, `finishReason` and `usage`. (Decoding the wire bytes is tested in Tasks 4–7.)
- [ ] **Step 2:** Record Ollama with `npm run record:streams` (live, via the host proxy as in v1.0.1). Write OpenAI, Anthropic and Gemini fixtures **verbatim from the providers' documented streaming examples**, citing the URL in `source`. Don't invent bytes. Where a documented example is truncated, say so in `source` and complete only the framing (`[DONE]`, `message_stop`).
- [ ] **Step 3:** Write `expectedEvents` by hand from the wire bytes and spec §3.3. Fixtures are the oracle for Tasks 4–7: if unsure about an event, print `STOP:` rather than guess.
- [ ] **Step 4: Run** the test → PASS. **Commit** the fixtures alone as `test: add stream fixture corpus` (owner approves), then the test and script as `test: validate stream fixtures`.

### Task 4: `postStream`, streaming pipeline, route, OpenAI decoder/encoder

Spec §3.2, §3.3 (OpenAI).

**Files:**
- Create: `src/services/stream-pipeline.ts`, `src/transformers/adapters/openai.stream.ts`, `tests/contracts/stream-decoders.test.ts`, `tests/contracts/stream-sdk.test.ts`, `tests/integration/stream.test.ts`
- Modify: `src/services/http-client.ts`, `src/services/proxy.service.ts`, `src/routes/proxy.ts`, `src/config/env-config.ts`, `src/transformers/adapters/openai.adapter.ts`, `src/transformers/adapters/index.ts`, `tests/mocks/upstreams.ts`, `src/services/proxy.service.test.ts` (new cases)

**Interfaces:**
- Consumes: Task 2 types and utils; Task 3 fixtures.
- Produces:
  - `postStream(opts: UpstreamRequestOptions & { signal?: AbortSignal }): Promise<UpstreamStreamResponse>`; `interface UpstreamStreamResponse { status: number; body: ReadableStream<Uint8Array>; durationMs: number }`. 2xx resolves at headers. Non-2xx reads the body as JSON (or `null`) and throws the same `UpstreamError` as `requestJson`. Retries as `requestJson`, before headers only.
  - `runStreamPipeline(opts: { upstream: ReadableStream<Uint8Array>; decoder: StreamDecoder; encoder: StreamEncoder; idleMs: number; signal: AbortSignal }): AsyncIterable<string>` — yields encoded chunks. On idle timeout, undecodable data or upstream read errors, it feeds the encoder a canonical `error` event (`kind` `timeout` for idle, `upstream` otherwise) and stops. Exposes nothing else.
  - `ProxyResult` gains `headers?: Record<string, string>` and `stream?: { contentType: string; chunks: AsyncIterable<string> }`; `body` becomes optional. `proxyRequest(path, method, body, requestId, opts?: { query?: Record<string, string>; signal?: AbortSignal })`.
  - `ProviderRoute.streamRequestPath?: (model?: string) => string` (Gemini only; added in Task 7).
  - `Config.upstreamStreamIdleMs: number` from `UPSTREAM_STREAM_IDLE_MS`, default `300_000`.
  - `openaiAdapter.createStreamDecoder` / `createStreamEncoder` per spec §3.3; `fromCanonicalRequest` sets `stream: true` and `stream_options: { include_usage: true }` when canonical `stream` is true.
  - `tests/mocks/upstreams.ts`: `streamCase: Partial<Record<Provider, string>>` (default `"text"`) and `resetStreamCase()`; when the upstream request asks to stream, the handler serves `tests/fixtures/streams/<p>/<case>.*` with the provider's content type, in 7-byte chunks.

- [ ] **Step 1: Tests.**
  - `stream-decoders.test.ts` (generated per provider and case; OpenAI rows now): `"openai/<case> decodes to the fixture's events"`; `"openai/<case> decodes identically at every split point"` (fixtures under 4 KB); `"openai truncated stream ends with an error event"` (drop `[DONE]` and the last chunk).
  - `stream-sdk.test.ts`: `"openai SDK parses encoded <case>"` — encode the fixture's `expectedEvents` with `createStreamEncoder({ sourceRequest: { …, stream: true, stream_options: { include_usage: true } }, query: {}, requestedModel: "m" })`, serve via msw, read with `openai` `client.chat.completions.stream(...)`. `finalChatCompletion()` matches the reassembled response (content, `tool_calls` names and arguments, `finish_reason`, usage). `"openai encoder omits the usage chunk unless include_usage"`.
  - `tests/integration/stream.test.ts`: `"openai → openai stream:true streams SSE"` (content type `text/event-stream`, body ends with `data: [DONE]`); `"stream request upstream 404 → JSON error in source dialect"` (status 404, OpenAI error shape, not SSE); `"truncated upstream → client receives in-stream error"`; `"client disconnect aborts upstream"` (abort the client request after the first chunk; the msw handler's `request.signal` fires `abort`; no unhandled rejection); `"idle timeout → in-stream timeout error"` (`UPSTREAM_STREAM_IDLE_MS=50`, upstream stalls).
  - `proxy.service.test.ts`: `"stream branch returns stream, not body"`; `"pair without stream support still returns 501"` (OpenAI source, Ollama target, before Task 6).
  - `tests/integration/errors.test.ts`: replace the OpenAI → OpenAI `stream:true → 501` case (Global Constraints exception).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In `proxy.service`, the stream branch first calls the target's `createStreamDecoder` and the source's `createStreamEncoder`. If either throws `NotSupportedError` (a Task 2 stub), the v1.0.1 501 is returned before any upstream call, so pairs light up as Tasks 5–7 land. The route sets headers (`contentType`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`) and writes chunks with backpressure (`await once(res, "drain")` when `write` returns false). An `AbortController` aborts on `res` `close` before completion. Log the completion line on `message_end` with `stream: true`.
- [ ] **Step 4: Run** `./scripts/check.sh` → PASS. For Step 9a, use `npm run dev` with `SOURCE_API=openai TARGET_API=openai` and `OPENAI_API_BASE_URL` pointing at the real Ollama's OpenAI-compatible endpoint (`<ollama>/v1`). Paste one streamed request/response. **Commit** `feat: streaming pipeline and OpenAI stream support`.

### Task 5: Anthropic stream decoder/encoder

Spec §3.3 (Anthropic), §3.4 (buffered arguments).

**Files:**
- Create: `src/transformers/adapters/anthropic.stream.ts`
- Modify: `src/transformers/adapters/anthropic.adapter.ts`, `tests/contracts/stream-decoders.test.ts`, `tests/contracts/stream-sdk.test.ts`, `tests/integration/stream.test.ts` (new cases), `tests/integration/errors.test.ts` (replace the 501 cases for the pairs this enables; Global Constraints exception)

**Interfaces:**
- Consumes: Task 4's pipeline, test generators and mock `streamCase`.
- Produces: `anthropicAdapter.createStreamDecoder` / `createStreamEncoder`; `fromCanonicalRequest` sets `stream: true`.
- Decoder: `message_start` → `message_start` + input tokens held; `content_block_start{text}` → nothing; `text_delta` → `text_delta`; `content_block_start{tool_use}` → `tool_call_start` (next index); `input_json_delta` → `tool_call_delta`; `content_block_stop` of a tool block → `tool_call_end`; `thinking_delta`, `signature_delta`, thinking blocks and `ping` → nothing; `message_delta` → `usage` (input from `message_start` + output) then `message_end`; `event: error` → `error` via `toCanonicalError`.
- Encoder: `message_start` with `ctx.requestedModel`. Opens and closes text blocks around text runs. Buffers each tool call's arguments until `tool_call_end`, then emits `content_block_start{tool_use, input: {}}`, one `input_json_delta` with `JSON.stringify(parseToolArguments(buffer).args)`, and `content_block_stop`. Then `message_delta{stop_reason, usage.output_tokens}`, `message_stop`. `error` → `event: error` with `fromCanonicalError`.

- [ ] **Step 1: Tests** (rows added to the generated suites): `"anthropic/<case> decodes to the fixture's events"`, `"... at every split point"`, `"anthropic truncated stream ends with an error event"`, `"anthropic decoder drops thinking deltas"`; `"anthropic SDK parses encoded <case>"` — `client.messages.stream(...).finalMessage()` has text and `tool_use` blocks with parsed `input`; `"interleaved parallel calls"` — events with index 1's deltas before index 0's end → SDK final message has both `tool_use` blocks with correct inputs and distinct IDs; `"empty arguments become {}"`; `"invalid arguments become the _invalid_arguments wrapper"`. Integration: `"anthropic → openai stream:true"` and `"openai → anthropic stream:true"` stream in the source's format.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `./scripts/check.sh` → PASS. **Commit** `feat: Anthropic stream support`.

### Task 6: Ollama stream decoder/encoder

Spec §3.3 (Ollama).

**Files:**
- Create: `src/transformers/adapters/ollama.stream.ts`
- Modify: `src/transformers/adapters/ollama.adapter.ts`, `tests/contracts/stream-decoders.test.ts`, `tests/contracts/stream-sdk.test.ts`, `tests/integration/stream.test.ts` (new cases), `tests/integration/errors.test.ts` (replace the 501 cases for the pairs this enables; Global Constraints exception)

**Interfaces:**
- Produces: `ollamaAdapter.createStreamDecoder` / `createStreamEncoder`.
- Decoder: NDJSON lines via `createLineSplitter`; `message.content` → `text_delta`; `message.tool_calls[k]` (arguments object) → `tool_call_start` (ID from `ids`) + one `tool_call_delta` (`JSON.stringify(arguments)`) + `tool_call_end`; `thinking` ignored; final `done: true` → `usage` (`prompt_eval_count`, `eval_count`) + `message_end` (`done_reason`, with tool calls present → `tool_call`); `{"error": …}` line → `error`.
- Encoder: one NDJSON line per text delta; a line with `message.tool_calls` per completed call (arguments via `parseToolArguments`); the final line `done: true` with counts and `done_reason`; content type `application/x-ndjson`.

- [ ] **Step 1: Tests:** decoder rows (fixture, every split point, `"ollama truncated stream ends with an error event"`); `"ollama SDK parses encoded <case>"` (`ollama` `chat({ stream: true })` iteration; concatenated content and tool calls match); integration `"anthropic → ollama stream:true"`, `"openai → ollama stream:true"`, `"ollama → openai stream:true"`.
- [ ] **Step 2–4:** FAIL → implement → `./scripts/check.sh` PASS. Real request against `npm run dev` + real Ollama (Anthropic source, `stream: true`), pasted in the PR. **Commit** `feat: Ollama stream support`.

### Task 7: Gemini stream decoder/encoder

Spec §3.3 (Gemini).

**Files:**
- Create: `src/transformers/adapters/gemini.stream.ts`
- Modify: `src/transformers/adapters/gemini.adapter.ts`, `src/transformers/adapters/index.ts` (`streamRequestPath`), `src/services/proxy.service.ts` (use `streamRequestPath`; remove the streaming 501), `tests/contracts/stream-decoders.test.ts`, `tests/contracts/stream-sdk.test.ts`, `tests/integration/stream.test.ts`, `tests/integration/errors.test.ts` (narrow the v1.0.1 streaming-refusal cases)

**Interfaces:**
- Produces: `geminiAdapter.createStreamDecoder` / `createStreamEncoder`; Gemini chat route `streamRequestPath: (m) => \`/v1beta/models/${m}:streamGenerateContent?alt=sse\``.
- Decoder: each `data:` is a `GenerateContentResponse`; text parts → `text_delta`; `functionCall` parts → start (ID = `functionCall.id` if present, else `ids()`) + one delta + end; the last `usageMetadata` → `usage`; `finishReason` → `message_end`; an error body → `error`.
- Encoder: `ctx.query.alt === "sse"` → SSE `data:` lines; otherwise a streamed JSON array (`[`, elements separated by `,\r\n`, `]`) with content type `application/json`.

- [ ] **Step 1: Tests:** decoder rows (fixture, every split point, `"gemini truncated stream ends with an error event"`); `"gemini SDK parses encoded <case>"` (`@google/generative-ai` `generateContentStream` → aggregated `response` text and `functionCalls()`); `"gemini array form without alt=sse"`; integration `"gemini :streamGenerateContent?alt=sse → ollama"`, `"anthropic → gemini stream:true"`.
- [ ] **Step 2:** Now every adapter streams: remove the v1.0.1 streaming-refusal path from `proxy.service` (the stub check from Task 4 goes with it). Replace the remaining v1.0.1 streaming 501 cases, including `"gemini :streamGenerateContent → 501, no upstream call"`, per the Global Constraints exception.
- [ ] **Step 3–4:** implement → `./scripts/check.sh` PASS. **Commit** `feat: Gemini stream support; streaming on for all adapters`.

### Task 8: Tools: OpenAI + Ollama

Spec §3.4.

**Files:**
- Modify: `src/transformers/adapters/openai.adapter.ts`, `src/transformers/adapters/ollama.adapter.ts`
- Test: `src/transformers/adapters/openai.adapter.test.ts`, `src/transformers/adapters/ollama.adapter.test.ts` (new cases)

**Interfaces:**
- Consumes: Task 2 `toolChoice`, `IdGenerator`, `parseToolArguments`.
- Produces: OpenAI reads/writes `tool_choice` ↔ `toolChoice` (`"auto"|"none"|"required"|{type:"function",function:{name}}`). Ollama reads/writes `tools`, assistant `tool_calls` (arguments object ↔ JSON string; IDs via `ids`), `role: "tool"` results (+ `tool_name` from the matching assistant call); `toolChoice` other than `auto` → `ValidationError("Ollama does not support tool_choice \"<value>\"")` → 400.

- [ ] **Step 1: Tests:** `"openai toolChoice round trip"` (all four forms); `"ollama tools definitions pass through"`; `"ollama assistant tool_calls → canonical with generated IDs"` (`sequentialIds()` → `call_0`, `call_1`); `"ollama tool result carries tool_name from history"`; `"ollama rejects toolChoice required"`; `"ollama invalid canonical arguments become the wrapper"`.
- [ ] **Step 2–4:** FAIL → implement → `./scripts/check.sh` PASS. Existing contract snapshots unchanged. **Commit** `feat: tool calling for OpenAI and Ollama`.

### Task 9: Tools: Anthropic

Spec §3.4 (Anthropic rules).

**Files:**
- Modify: `src/transformers/adapters/anthropic.adapter.ts`, `src/types/anthropic.types.ts`
- Test: `src/transformers/adapters/anthropic.adapter.test.ts` (new cases)

**Interfaces:**
- Produces: `tools[]` (`input_schema`) ↔ canonical tools; `tool_choice` (`auto`→`auto`, `any`→`required`, `{type:"tool",name}`→function choice, `none`→`none`); assistant `tool_use` blocks ↔ `toolCalls` (`input` via `parseToolArguments` on encode); user messages with `tool_result` blocks split into canonical `role: "tool"` messages in order (+ `isError` from `is_error`; `content` string or text/image blocks), followed by a user message for any other blocks; consecutive canonical tool messages merged into one user message on encode; assistant text before tool calls on encode.

- [ ] **Step 1: Tests:** `"anthropic tool_choice round trip"`; `"user message with 3 tool_results splits into 3 tool messages then text"`; `"consecutive tool messages merge into one user message"`; `"is_error maps to isError and back"`; `"tool_result with text blocks becomes string content"`; `"assistant text then tool_use order on encode"`; `"empty tool input encodes as {}"`.
- [ ] **Step 2–4:** FAIL → implement → `./scripts/check.sh` PASS. **Commit** `feat: tool calling for Anthropic`.

### Task 10: Tools: Gemini

Spec §3.4 (Gemini rules).

**Files:**
- Create: `src/transformers/adapters/gemini.schema.ts`
- Modify: `src/transformers/adapters/gemini.adapter.ts`, `src/types/gemini.types.ts`, `docs/decisions.md`
- Test: `src/transformers/adapters/gemini.schema.test.ts`, `src/transformers/adapters/gemini.adapter.test.ts` (new cases)

**Interfaces:**
- Produces: `toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown>` — recursive. Keeps only Google's documented schema keywords; the task records the allow-list and its source URL in `docs/decisions.md`. Drops the rest, at every depth (`properties.*`, `items`, `anyOf`).
- Produces (adapter): `tools[].functionDeclarations` ↔ canonical tools (parameters through `toGeminiSchema` on encode); `toolConfig.functionCallingConfig` ↔ `toolChoice` (`AUTO`↔`auto`, `NONE`↔`none`, `ANY`↔`required`, `ANY`+`allowedFunctionNames:[n]`↔function choice); `functionCall` parts ↔ `toolCalls` (ID from `functionCall.id` or `ids()`; `id` dropped on encode); canonical tool messages → `functionResponse` parts (`name` from the matching assistant call in the same request; content parsed as a JSON object if it is one, otherwise `{ "content": "<string>" }`; consecutive tool messages share one `user` turn).

- [ ] **Step 1: Tests:** `"toGeminiSchema drops $schema, additionalProperties and default at every depth"` (use a real Claude Code-style schema with nested `properties` and `items`); `"toGeminiSchema keeps documented keywords"`; `"gemini toolChoice round trip"`; `"gemini functionCall gets a generated ID"`; `"gemini functionResponse finds the name from history"`; `"gemini string tool result is wrapped as {content}"`; `"gemini tool result with no matching call → ValidationError"`.
- [ ] **Step 2–4:** FAIL → implement → `./scripts/check.sh` PASS. **Commit** `feat: tool calling for Gemini`.

### Task 11: Claude Code essentials

Spec §3.5.

**Files:**
- Create: `src/utils/model-map.ts`, `src/services/token-estimate.ts`
- Modify: `src/transformers/adapters/anthropic.adapter.ts`, `src/transformers/adapters/ollama.adapter.ts` (`num_ctx`), `src/transformers/adapters/index.ts` (`RouteKind` `"count_tokens"`, Anthropic route `POST /v1/messages/count_tokens`), `src/services/proxy.service.ts`, `src/routes/proxy.ts` (response headers), `src/config/env-config.ts`, `docs/decisions.md`
- Test: `src/utils/model-map.test.ts`, `src/services/token-estimate.test.ts`, `src/transformers/adapters/anthropic.adapter.test.ts`, `tests/integration/claude-code.test.ts`

**Interfaces:**
- Produces: `interface ModelMapRule { pattern: string; model: string }`; `parseModelMap(value: string | undefined): ModelMapRule[]` (comma-separated `glob=model`; `*` matches any run of characters; anything else invalid → `ConfigurationError("MODEL_MAP entry \"<entry>\" must be glob=model")`); `applyModelMap(model: string, rules: ModelMapRule[]): string` (first match wins).
- Produces: `Config.modelMap: ModelMapRule[]` (`MODEL_MAP`); `Config.targetContextWindow?: number` (`TARGET_CONTEXT_WINDOW`, positive integer else `ConfigurationError`).
- Produces: `estimateInputTokens(req: CanonicalRequest): number` = `Math.ceil(chars / 4)` over the system prompt, message text, tool-call arguments, tool-result content and `JSON.stringify(tools)`.
- Behaviour: `proxy.service` applies the model map after decoding, sets `config.contextWindow` from config, and sets the response `model` back to the requested name. `count_tokens` → `{ body: { input_tokens: N }, headers: { "x-babelgate-token-estimate": "true" } }` with no upstream call. Anthropic `system` arrays are joined with `"\n\n"`; `thinking` / `redacted_thinking` blocks, the `thinking` param, `cache_control` and `metadata` are dropped (debug log with the type name only); unknown content-block types → `ValidationError("Unsupported content block type \"<type>\"")` → 400 in the Anthropic dialect.

- [ ] **Step 1: Tests:** `"model map first match wins"`, `"no match leaves the model"`, `"invalid MODEL_MAP fails at startup"`; `"estimate counts system, messages, tool args, results and tool definitions"` (a known request → an exact N); `"system array joins with blank line"`; `"thinking blocks and cache_control are dropped"`; `"unknown block type → 400 naming it"`. Integration (`claude-code.test.ts`): `"/v1/messages?beta=true streams with MODEL_MAP applied"` (upstream receives the mapped model; the client sees the requested model in `message_start`); `"count_tokens answers locally with the estimate header"` (no upstream request captured); `"TARGET_CONTEXT_WINDOW sets Ollama num_ctx"`; `"anthropic-beta header is accepted"`.
- [ ] **Step 2–4:** FAIL → implement → `./scripts/check.sh` PASS. Real request: Anthropic-format `count_tokens` and a streamed `/v1/messages` against `npm run dev` + real Ollama, in the PR. **Commit** `feat: Claude Code essentials (count_tokens, MODEL_MAP, context window)`.

### Task 12: Property tests + launch-pair matrix

Spec §4.4, §4.5, §5.

**Files:**
- Create: `tests/contracts/stream-properties.test.ts`, `tests/integration/stream-pairs.test.ts`
- Modify: `tests/mocks/upstreams.ts` (tool-call fixtures selectable per provider)

**Interfaces:**
- Consumes: everything above. Produces: a `LAUNCH_PAIRS = [["anthropic","ollama"],["anthropic","openai"],["openai","ollama"]]` constant at the top of `stream-pairs.test.ts`; Task 17 replaces it with all 16 pairs.

- [ ] **Step 1: Tests.**
  - Properties (seeded `mulberry32(seed)` generator in the test file; 200 cases per adapter; the seed is printed on failure): `"<p> decode(encode(events)) equals events"` for random valid event sequences (text runs, 0–3 tool calls with interleaved deltas, optional usage, a finish reason). Anthropic's buffered arguments are compared after `reassembleStream`, not event by event (documented in the test). `"<p> stream reassembles to the non-streaming twin"` for every fixture with `nonStreaming`.
  - Pair matrix, for each launch pair × {`text`, `tool_call`, `parallel_tool_calls`, `after_tool_result`} × {stream, non-stream}: the client receives its own format; for tool cases the client sees the right tool names, parsed arguments and distinct IDs; `after_tool_result` sends a tool result back and the upstream request contains it in the target's format.
- [ ] **Step 2–4:** run → fix in adapters only (never in tests or fixtures; a fixture problem → `STOP:`) → `./scripts/check.sh` PASS. **Commit** `test: stream properties and launch-pair matrix`.

### Task 13: CLI + presets · OWNER GATE

Spec §3.6. PR title starts `[OWNER GATE]`.

**Files:**
- Create: `src/cli.ts`, `src/cli.test.ts`
- Modify: `package.json` (`bin: { "babelgate": "dist/cli.js" }`, `files: ["dist", "README.md", "LICENSE", "NOTICE"]`), `src/index.ts` (export `startServer(): Promise<Server>` if it isn't already importable without side effects)

**Interfaces:**
- Produces: `interface CliArgs { preset?: "claude-code" | "openai-apps"; target?: Provider; model?: string; baseUrl?: string; port?: number; help?: boolean }`; `parseCliArgs(argv: string[]): CliArgs` (unknown flag or invalid value → throws with the flag name); `presetEnv(args: CliArgs, env: NodeJS.ProcessEnv): Record<string, string>` (values the user's own env already sets are not returned); `clientInstructions(args: CliArgs, port: number, proxyApiKey?: string): string[]`; `main(argv: string[]): Promise<void>`.
- Preset values (spec §3.6): `claude-code` → `SOURCE_API=anthropic`, `MODEL_MAP=claude-*=<model>`, `TARGET_CONTEXT_WINDOW=32768`, and for `--target ollama` `UPSTREAM_TIMEOUT_MS=600000`; prints `export ANTHROPIC_BASE_URL=http://localhost:<port>` and `export ANTHROPIC_AUTH_TOKEN=<PROXY_API_KEY or babelgate>`. `openai-apps` → `SOURCE_API=openai`; prints `export OPENAI_BASE_URL=http://localhost:<port>/v1` and `export OPENAI_API_KEY=<PROXY_API_KEY or babelgate>`. `--base-url` → `<TARGET>_API_BASE_URL`. There is no flag for keys.

- [ ] **Step 1: Tests:** `"claude-code + ollama preset env"` (exact map above); `"user env wins over preset"`; `"openai-apps instructions"` (exact lines); `"--base-url sets the target base URL"`; `"unknown flag throws naming it"`; `"no flag accepts an API key"` (`--api-key x` throws).
- [ ] **Step 2–4:** FAIL → implement → `./scripts/check.sh` PASS → `npm pack --dry-run` lists only the `files` entries (paste it). Run `node dist/cli.js --preset claude-code --target ollama --model qwen2.5:0.5b`, paste the printed lines and a `curl /health`. **Commit** `feat: babelgate CLI with claude-code and openai-apps presets`.

### Task 14: GHCR release workflow · OWNER GATE

Spec §3.6. PR title starts `[OWNER GATE]`.

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1:** `on: push: tags: ['v*']` only; `permissions: { contents: read, packages: write }`; `docker/login-action` with `GITHUB_TOKEN`, `docker/build-push-action` pushing `ghcr.io/dorrabbkhan/babelgate:<tag without v>` and `:latest`. Actions pinned by commit SHA with a version comment. No npm publish.
- [ ] **Step 2:** `check` must pass on the PR. The workflow runs only on the owner's tag; say so in the PR. **Commit** `ci: publish the Docker image to GHCR on release tags`.

### Task 15: Live streaming and tools; Claude Code gate · OWNER REVIEW

Spec §4.6, §4.7, D3. PR title starts `[OWNER REVIEW]`.

**Files:**
- Create: `tests/live/stream.live.test.ts`, `scripts/gates/claude-code-edit.sh`, `scripts/gates/fixtures/edit-task/{package.json,src/sum.js,test/sum.test.js}`
- Modify: `tests/live/live.helpers.ts` (OpenRouter target), `.github/workflows/live.yml` (`OPENROUTER_API_KEY` secret env)

**Interfaces:**
- Produces: `liveTargets()` adds `"openrouter"` as an OpenAI target (base URL `https://openrouter.ai/api/v1`, key `OPENROUTER_API_KEY`, model `LIVE_OPENROUTER_MODEL`, default `qwen/qwen3-coder`) when the key is set.
- Produces: `scripts/gates/claude-code-edit.sh <ollama|openrouter> [model]` — copies `edit-task` to `mktemp -d`; builds and starts `node dist/cli.js --preset claude-code --target <t> --model <m>` (OpenRouter: `--target openai --base-url https://openrouter.ai/api/v1`, `OPENAI_API_KEY=$OPENROUTER_API_KEY`); waits for `/health`; runs Claude Code non-interactively with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` from the printed lines, the prompt `Make the failing test pass. Run npm test to check your work.`, file edits allowed and `npm test` the only allowed command (exact flags from `claude --help` at the time); then runs `npm test` itself. Prints `GATE PASS`/`GATE FAIL`, `claude --version`, model and duration; exit 0 only on pass. Defaults: `qwen3-coder:30b` for ollama, `qwen/qwen3-coder` for openrouter.
- `edit-task`: no dependencies, `node --test`; `sum(a, b)` returns `a - b`; the test expects `sum(2, 3) === 5`.

- [ ] **Step 1: Live tests:** for `ollama` and (if set) `openrouter` × sources `anthropic` and `openai`: `"<source> → <target> streams text"` (at least 2 chunks, a terminal event, usage); `"<source> → <target> accepts tool definitions"` (a well-formed reply, text or tool call). `openrouter` only: `"forced tool call"` (`toolChoice` required → a tool call with parseable arguments).
- [ ] **Step 2: Run** `npm run test:live` (Ollama via the host proxy) → PASS; paste the summary. Run `scripts/gates/claude-code-edit.sh ollama` if `qwen3-coder:30b` is pulled; otherwise say so. The owner (or the conductor, on the owner's machine) runs both gate targets before Task 16 and pastes the output.
- [ ] **Step 3: Commit** `test: live streaming and tools; Claude Code edit gate`.

### Task 16: README, recipes, CHANGELOG, `1.1.0` · OWNER GATE

Spec §3.8, §1.3. PR title starts `[OWNER GATE]`.

**Files:**
- Create: `docs/recipes/claude-code.md`, `docs/recipes/openai-sdk.md`
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (`version: "1.1.0"`), `package-lock.json` (version only), `docs/roadmap.md` (status line), `docs/decisions.md`

- [ ] **Step 1:** README: the quick-start is `npx babelgate --preset claude-code --target ollama --model qwen3-coder:30b` plus the printed lines, then `claude`; the OpenRouter and OpenAI-app variants; recommended tool-capable models; known limitations (reasoning not mapped, `parallel_tool_calls` control ignored, milestone 2 pairs). A demo GIF from the owner's OpenRouter gate run (path `docs/assets/demo.gif`; the owner supplies it, or the PR leaves a marked slot the owner fills before merge).
- [ ] **Step 2:** Every claim checked against the code (as in v1.0.1 Task 9). CHANGELOG `## [1.1.0] - <date>`: Added (streaming, tools, Claude Code support, CLI, GHCR), Changed (rename; streaming no longer 501), Known limitations. Recipes carry the exact commands from the gate run.
- [ ] **Step 3:** `npm version 1.1.0 --no-git-tag-version`; `./scripts/check.sh` PASS. **Commit** `docs: release notes and README for 1.1.0`. Owner after merge: tag `v1.1.0`, `npm publish` with 2FA, and the launch posts.

### Task 17: M2: full 16-pair streaming × tools matrix

Spec §1.3 (milestone 2), §5.

**Files:**
- Modify: `tests/integration/stream-pairs.test.ts` (`ALL_PAIRS` replaces `LAUNCH_PAIRS`), adapter files as needed, `docs/decisions.md`

- [ ] **Step 1:** Widen the matrix to all 16 pairs. **Step 2:** run; fix failures **inside adapters only**. A fix that seems to need a pair-specific branch → `STOP:` (the canonical format is missing something). **Step 3:** `./scripts/check.sh` PASS; record each fix in `docs/decisions.md`. **Commit** `test: streaming × tools matrix across all 16 pairs`.

### Task 18: M2: Gemini and Ollama sources live; `1.1.1` · OWNER GATE

Spec §1.3 (milestone 2).

**Files:**
- Modify: `tests/live/stream.live.test.ts` (sources `gemini`, `ollama`), `CHANGELOG.md`, `package.json`/`package-lock.json` (`1.1.1`), `docs/roadmap.md`

- [ ] **Step 1:** Add the Gemini- and Ollama-source live cases (stream text, tool definitions accepted). **Step 2:** `npm run test:live` PASS (paste). **Step 3:** CHANGELOG `## [1.1.1]` (milestone 2: all pairs); version `1.1.1`. **Commit** `test: live Gemini and Ollama sources; release 1.1.1`. Owner after merge: tag `v1.1.1`, publish.
