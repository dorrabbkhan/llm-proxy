# babelgate v1.2 — Design Spec ("One endpoint, many providers")

**Date:** 2026-10-29 · **Status:** design approved section by section by the owner on 2026-10-29; this
written spec awaits owner review · **Roadmap:** `docs/roadmap.md` (Phase 2, v1.2) ·
**Parent spec:** `docs/superpowers/specs/2026-10-26-babelgate-roadmap-design.md` ·
**Previous version:** `docs/superpowers/specs/2026-10-27-babelgate-v1.1-design.md`

## 1. Purpose

One babelgate instance serves every client format on one port and routes each request to one of several
configured providers by model name, with aliases, fallbacks and a merged model list. The headline use: a
Claude Code user runs routine work on local Ollama and sends long contexts — or outages — to a cloud model,
from one config file.

### 1.1 Why this shape
v1.1 launched "Claude Code on anything" with one source and one target per instance. The roadmap's v1.2
gateway features (routing, aliases, fallbacks, merged list, YAML, OpenAI-compatible targets) are table
stakes — LiteLLM now also accepts Anthropic-format requests — so v1.2 adds a headline aimed at the launch
audience (Claude Code hybrid routing) and closes the v1.1 release-gate gaps. The owner chose this scope
(D1). The single-target config is also the bottleneck for v1.3 (per-route usage records) and v2.0 (an
`onRoute` hook); refactoring it now, while the codebase is small, is the cheapest point.

### 1.2 Evidence (read from the code on main, 2026-10-29)
| # | Finding | Where | Effect |
|---|---|---|---|
| G1 | Config holds one `sourceApi`, `targetApi`, `targetBaseUrl`, `targetApiKey` | `config/env-config.ts` | No multi-provider instance |
| G2 | Source format comes from config, not the request | `middleware/resolve-source.ts`, `proxy.service.ts` | One client format per port |
| G3 | OpenAI and Anthropic both serve `GET /v1/models` | `PROVIDER_ROUTES` in `transformers/adapters/index.ts` | Serving all formats at once needs a tie-break |
| G4 | Auth headers are built per target in the service | `buildAuthHeaders` in `proxy.service.ts` | Must become per provider |
| G5 | `MODEL_MAP` rewrites model names; the roadmap adds routes and aliases | `utils/model-map.ts` | Three overlapping mechanisms unless unified |
| G6 | `postStream` resolves on response headers, before any byte reaches the client | `services/http-client.ts` | Fallback before first byte needs no new mechanism |
| G7 | `proxy.service.ts` is ~15 KB and owns chat, stream, models and count_tokens | `services/proxy.service.ts` | The file v1.2 changes most; split it |
| G8 | v1.1 gaps: Claude Code ↔ Ollama never gate-tested on a capable model; Gemini target never had a clean live run | `docs/decisions.md` (v1.1 Task 15) | Headline promise untested |

### 1.3 Success criteria
- One instance with a YAML config of ≥ 2 providers serves OpenAI, Anthropic, Gemini and Ollama clients on
  one port; each request reaches the provider its model resolves to (§3.3).
- A v1.1 env-only setup behaves identically, except that the other formats' paths now answer (§3.8).
- Fallbacks follow §3.4 exactly, streaming included; every hop is logged and exposed in headers.
- The full existing suite, including the 16-pair streaming × tools matrix, passes with no changed
  expected values.
- Release gates (§4.5) pass: Claude Code edit gate on rented-GPU Ollama `qwen3-coder:30b`; the same gate
  with `examples/claude-code-hybrid.yaml`; a clean live run of the Gemini target.

## 2. Scope

### 2.1 In v1.2
1. Behaviour-neutral refactor: provider registry, explicit service inputs, `proxy.service` split (§3.1).
2. All formats on one port, source detected from the request; `SOURCE_API` deprecated (§3.2).
3. One rule list for routing: explicit `provider/model`, aliases, ordered glob routes with a `when`
   condition, default provider; `MODEL_MAP` carried over (§3.3).
4. Optional `babelgate.yaml` for ≥ 2 providers; OpenAI-compatible backends as config (§3.5).
5. Fallback chains before the first byte; `x-babelgate-*` response headers; route log line (§3.4).
6. Merged model list with a 60 s cache (§3.6).
7. CLI: `--config`, endpoints block, routing table (§3.7).
8. Examples, recipes, README, GPU gate runbook (§3.9); tests and gates (§4).

### 2.2 Not in v1.2
- Reloading config without a restart; weighted/random splits; A/B or shadow traffic (v2.3).
- `when` conditions other than `min_input_tokens` (e.g. thinking, web search, tool presence).
- Health checks, circuit breakers, load balancing across keys or hosts (v1.5).
- Usage store, cost, UI, metrics (v1.3). Reasoning mapping, embeddings, structured output (v1.4).
- Ollama endpoints other than `/api/chat` and `/api/tags` (`/api/version`, `/api/show`, `/api/generate`) —
  recorded as a follow-up for Open WebUI's Ollama mode.
- An overall request deadline across fallback hops.
- A `babelgate init` command (examples files instead).

### 2.3 Non-goals
- Provider-pair special cases; adapter changes. Adapters, canonical types/schema, `stream-pipeline`,
  `http-client` and error rendering do not change.
- Changing any existing timeout or retry default. Per-provider values are overrides only.
- Keys in config files.

## 3. Design

### 3.1 Architecture (approach 1: thin routing layer, D5)

Request flow:
```
request
  → requestLogger
  → detectSource                         → res.locals.sourceApi   (replaces resolveSource)
  → body parser → requireApiKey           (unchanged)
  → proxy router → service:
       1. route     = findSourceRoute(source, method, path)
       2. models    → merged model list (§3.6)
       3. canonical = adapters[source].toCanonicalRequest(body)    (decoded once)
       4. count_tokens → local estimate (unchanged)
       5. plan      = planRoute(requestedModel, canonical, routing, registry)
       6. attemptTargets(plan): per target — encode with registry provider's adapter,
          postJson/postStream with its URL, auth and timeouts; fallback per §3.4
       7. decode reply → model := requestedModel → encode in the client's format
       8. route log line (§3.4)
```

Units:
| Unit | Job | Depends on |
|---|---|---|
| `src/routing/registry.ts` | `ProviderRegistry`: name → `ProviderEntry {name, type, baseUrl, apiKey?, contextWindow?, timeoutMs?, streamIdleMs?}`; `authHeaders(entry)` (moved from `buildAuthHeaders`); `get(name)`, `names()`, `defaultName` | config types, `Provider` |
| `src/routing/detect-source.ts` | `detectSource(method, path, headers) → Provider \| undefined` (§3.2) | `PROVIDER_ROUTES` |
| `src/routing/rules.ts` | Glob matching (moved from `utils/model-map.ts`), `parseTarget(text, registryNames) → {provider, model}` | none |
| `src/routing/plan-route.ts` | Pure: `planRoute(input) → RoutePlan` (§3.3) | rules |
| `src/routing/fallback.ts` | `isFallbackEligible(err) → boolean` (§3.4) | `utils/errors` |
| `src/config/env-config.ts` | Scalars + a one-provider registry from v1.1 env vars | registry types |
| `src/config/yaml-config.ts` | File discovery, parse, validate, build registry and routing | `yaml`, schema |
| `src/config/gateway.schema.ts` | Strict Zod schema for `babelgate.yaml` | `zod` |
| `src/services/chat.service.ts` | Non-streaming chat over a `RoutePlan` | routing, adapters, http-client |
| `src/services/chat-stream.service.ts` | Streaming chat over a `RoutePlan` | as above, stream-pipeline |
| `src/services/models.service.ts` | Merged model list (§3.6) | registry, adapters |
| `src/services/attempt-targets.ts` | The fallback loop shared by both chat services | fallback, registry |
| `src/services/proxy.service.ts` | Thin entry: route match, decode, count_tokens, dispatch | the above |

```ts
export interface RouteTarget { provider: string; model: string }
export interface RoutePlan {
  targets: RouteTarget[];                 // ≥ 1; first is primary, rest are fallbacks in order
  reason: "explicit" | `alias:${string}` | `rule:${number}` | "default";
}
export interface PlanRouteInput {
  requestedModel: string;
  estimatedInputTokens: number;           // estimateInputTokens(canonical), computed once
  routing: RoutingConfig;                 // aliases, rules, defaultProvider
  providerNames: ReadonlySet<string>;
}
```
`planRoute` has no I/O, clock or randomness; its signature is shaped so v2.0 can expose it as `onRoute`.

`Config` becomes `GatewayConfig { port, proxyApiKey?, upstreamTimeoutMs, upstreamRetries,
upstreamStreamIdleMs, registry: ProviderRegistry, routing: RoutingConfig }`. `getConfig()` /
`resetConfig()` keep their names.

`contextWindow` is per provider: the attempt loop sets canonical `config.contextWindow` from the target
provider's entry (unset → field unset), replacing the global `targetContextWindow`.

### 3.2 Source detection and all formats on one port
`detectSource` uses the existing `PROVIDER_ROUTES` table:
| Request | Source |
|---|---|
| `POST /v1/chat/completions` | openai |
| `POST /v1/messages`, `POST /v1/messages/count_tokens` | anthropic |
| `GET`/`POST` under `/v1beta/models` | gemini |
| `POST /api/chat`, `GET /api/tags` | ollama |
| `GET /v1/models` | anthropic if an `anthropic-version` header is present, else openai |

- The `anthropic-version` assumption (Anthropic SDKs and Claude Code always send it) is verified against the
  SDK source and recorded with its source in task 2. If it does not hold, the tie-break is `x-api-key`
  present and `Authorization` absent → anthropic.
- `detectSource` runs as middleware before the body parser and auth (where `resolveSource` runs today), so
  auth and body-parser errors still render in the client's dialect.
- Unknown paths: generic 404, as today.
- `SOURCE_API`: ignored; one startup `warn` line says it is deprecated and removed in 2.0.

### 3.3 Routing rules
Resolution order for the client's model name (`requestedModel`: body model, or Gemini's path model):
1. **Explicit `provider/model`** — the text before the first `/` is a registered provider name → that
   provider, the rest as the model. Rules are skipped. Model names may contain `/`
   (`openrouter/qwen/qwen3-coder` → provider `openrouter`, model `qwen/qwen3-coder`). With no provider named
   `qwen`, `qwen/qwen3-coder` is not explicit and continues to step 2. Provider names win over model
   prefixes; documented.
2. **Alias** — exact, case-sensitive match on an alias name → its target.
3. **Routes** — in file order; the first route whose `match` glob matches and whose `when` holds.
4. **Default** — the default provider, model unchanged (D2).

Targets in YAML (`to`, `fallback[]`, alias values) must be `provider/model` with a registered provider
name before the first `/`; anything else is a startup error (§3.5), so a typo in a provider name never
silently routes to the default. `parseTarget` splits on the first `/` exactly as in step 1. The only
provider-less targets are `MODEL_MAP` entries in env-only mode, which mean the default provider (below).

`RoutePlan.targets` = the matched target followed by its `fallback` list. Aliases and the default have no
fallbacks (write a `match: "*"` route to get one).

Glob syntax: `*` matches any run of characters; everything else is literal (unchanged from `MODEL_MAP`).

`when` (object; all listed conditions must hold):
- `min_input_tokens: <positive int>` — holds when `estimatedInputTokens >= value`, using the existing
  `ceil(chars/4)` estimate (`utils/token-estimate.ts`).

`MODEL_MAP` (env-only mode): each `glob=model` entry becomes a route `{match: glob, to: model}` targeting
the default provider, in the same order. Behaviour is identical to v1.1.

Replies keep `requestedModel` (unchanged v1.1 rule), including alias names and explicit `provider/model`
names.

### 3.4 Fallbacks, headers and the route log line
**Eligible** (move to the next target): transport failure; timeout on connect or response headers
(provider `timeoutMs`, else `UPSTREAM_TIMEOUT_MS`); upstream `429`; upstream `500`, `502`, `503`, `504`,
`529`.
**Not eligible** (fail now, rendered in the client's dialect as today): upstream `400`, `401`, `403`,
`404`, `413`, `422`, and any other status; any error raised before the upstream call (validation,
transform).

- Retries inside one target are unchanged (`UPSTREAM_RETRIES`, transport/429/503). Fallback starts after a
  target's retries are exhausted. `Retry-After` is not waited on before falling back.
- **Streaming:** the fallback decision is made when `postStream` settles. A non-2xx status or a failure
  before response headers is eligible per the lists above. Once 2xx headers arrive the target is committed:
  no fallback; mid-stream failures produce the in-stream error of v1.1 §3.2.
- **All targets fail:** the last target's error, mapped and rendered as today.
- **Client disconnect** aborts the current attempt and ends the loop.
- **Latency:** worst case is the sum of per-attempt timeouts; no overall deadline (§2.2).

Response headers on every proxied chat reply (JSON and streaming; set before the first byte):
`x-babelgate-provider: <name>`, `x-babelgate-model: <upstream model>`, `x-babelgate-attempts: <n>`.
Error replies after one or more attempts carry `x-babelgate-attempts`.

Route log line — one `info` line per chat request, replacing "Forwarding request to upstream" and extending
"Request completed":
`{requestId, sourceApi, requestedModel, reason, hops: [{provider, model, outcome, status?, ms}], winner?,
stream, inputTokens?, outputTokens?, finishReason?}` where `outcome` ∈ `ok | http_error | timeout |
transport`. No prompt bodies, completions or keys. This record is the v1.3 usage-store row.

### 3.5 Configuration
**Discovery:** `--config <path>` → `BABELGATE_CONFIG` → `./babelgate.yaml` → env-only mode. An explicit
path that does not exist is a startup error; a missing `./babelgate.yaml` is not.

**Schema** (strict: unknown keys are errors):
```yaml
default: <provider name>                 # required
providers:                               # required, ≥ 1
  <name>:                                # [a-z0-9][a-z0-9_-]*
    type: openai | anthropic | gemini | ollama
    base_url: <url>                      # required
    api_key_env: <ENV_VAR_NAME>          # required unless type is ollama
    context_window: <positive int>       # optional
    timeout_ms: <positive int>           # optional, overrides UPSTREAM_TIMEOUT_MS
    stream_idle_ms: <positive int>       # optional, overrides UPSTREAM_STREAM_IDLE_MS
aliases:                                 # optional
  <name>: <target>                       # <target> = <provider>/<model>
routes:                                  # optional, ordered
  - match: <glob>
    when: { min_input_tokens: <positive int> }   # optional
    to: <target>
    fallback: [<target>, ...]            # optional
```
Startup errors (clear message naming the path in the file): schema violation; `default` not a provider;
a target that does not start with a registered provider name followed by `/`; an `api_key_env` whose variable is unset or empty; a duplicate alias;
an alias name that is also a provider name. OpenAI-compatible backends are `type: openai` with their own
`base_url`.

**Env vars with a YAML file:** `PORT`, `PROXY_API_KEY`, `UPSTREAM_TIMEOUT_MS`, `UPSTREAM_RETRIES`,
`UPSTREAM_STREAM_IDLE_MS`, `MAX_BODY_SIZE`, `LOG_LEVEL` apply as global defaults. `TARGET_API`,
`*_API_BASE_URL`, `MODEL_MAP`, `TARGET_CONTEXT_WINDOW` and `SOURCE_API` are ignored, with one startup
`warn` naming those that are set.

**Env-only mode (no YAML):** exactly v1.1's variables build a one-provider registry; the provider is named
after `TARGET_API` and is the default; `TARGET_CONTEXT_WINDOW` → its `contextWindow`; `MODEL_MAP` → routes
(§3.3). Validation messages are unchanged.

**Startup output:** the routing table — providers (name, type, base URL, key env name or "none"), aliases,
routes in order, default.

New dependency: `yaml` (eemeli/yaml, no dependencies) — D6.

### 3.6 Merged model list
Every source's list endpoint (`GET /v1/models`, `GET /v1beta/models`, `GET /api/tags`) returns, in the
client's format:
1. aliases, as bare names;
2. the default provider's models, as bare names (the v1.1 list);
3. every other provider's models as `<provider>/<model>`.

Provider lists are fetched in parallel, decoded with each provider's adapter into the existing canonical
model list, merged (first occurrence wins on a duplicate id), and encoded once by the source adapter. A
provider whose list fails is omitted with a `warn` line; the response stays 200 and carries
`x-babelgate-partial: true`. If every provider fails, the default provider's error is returned as today.
Each provider's list is cached in memory for 60 s (successful fetches only). Glob routes are not listed.

### 3.7 CLI
- New `--config <path>`. With a config file loaded, `--target`, `--model` and `--base-url` are errors
  ("defined by the config file").
- `--preset claude-code|openai-apps`: unchanged in env-only mode; with a config file it only selects which
  `export` lines to print.
- Without a preset, startup prints an endpoints block (OpenAI `…/v1`, Anthropic `…`, Gemini `…/v1beta`,
  Ollama `…`), then the routing table.
- `--help` documents `--config` and `BABELGATE_CONFIG`.

### 3.8 Compatibility and versioning
- Release `1.2.0` (minor). The only wire-visible change for an existing env-only setup: paths of the other
  three formats now answer instead of returning 404. CHANGELOG calls it out.
- New response headers `x-babelgate-provider`, `x-babelgate-model`, `x-babelgate-attempts`,
  `x-babelgate-partial` are additive.
- `SOURCE_API` deprecated in 1.2, removed in 2.0.

### 3.9 Docs and examples
- `examples/claude-code-hybrid.yaml`: Ollama default; `claude-*haiku*` → small local model; `claude-*` with
  `min_input_tokens` → OpenRouter; `claude-*` → `ollama/qwen3-coder:30b` with OpenRouter fallback.
- `examples/multi-provider.yaml`: Ollama + OpenRouter + Anthropic + aliases.
- README: "One endpoint, many providers" section built on the hybrid example.
- `docs/recipes/claude-code-hybrid.md`; `docs/recipes/openai-compatible-providers.md` (Groq, OpenRouter,
  DeepSeek, Together, LM Studio, vLLM, llama.cpp — each labelled **live-tested** or **from provider docs**,
  with the doc URL and date).
- `docs/gates/gpu-ollama.md`: rent a ≥ 24 GB GPU host, install Ollama, pull `qwen3-coder:30b`, expose it,
  run `scripts/gates/claude-code-edit.sh ollama qwen3-coder:30b` with `--base-url`, record the result,
  tear down. Target: ≤ 15 minutes per release.
- CHANGELOG `1.2.0`; roadmap status; one `docs/decisions.md` entry per owner decision (§6).

## 4. Testing

### 4.1 Unit (no network)
- `planRoute`: table tests for each resolution step and their order; model names containing `/`; provider
  name vs model prefix; `when.min_input_tokens` at, below and above the threshold; fallback lists; aliases
  and default without fallbacks; determinism.
- `parseTarget`, glob matching (existing `model-map` tests move with the code, unchanged).
- `detectSource`: every row of §3.2, including `/v1/models` with and without `anthropic-version`.
- `isFallbackEligible`: every status and failure kind in §3.4.
- Registry: auth headers per type (moved tests unchanged).
- YAML: a valid example per feature; one invalid file per startup error in §3.5.

### 4.2 Integration (msw, three mocked upstreams, one app)
- Each source format on one port reaches the provider its model resolves to.
- Fallback: 503 → success; 429 → success; header timeout → success; transport failure → success;
  400 and 401 → no fallback; stream non-2xx → fallback; stream after 2xx headers then upstream death →
  in-stream error, no fallback; all fail → last error in the client's dialect.
- `x-babelgate-*` headers on JSON and stream replies, and on errors after attempts.
- Merged model list per source format; partial failure; cache hit within 60 s.
- Env-only golden test: the `claude-code` and `openai-apps` preset envs produce the v1.1-equivalent registry
  and routes.

### 4.3 Backwards compatibility
After task 1 and at release, the full existing suite — contract tests, fixtures, snapshots, the 16-pair
streaming × tools matrix — passes with no changed expected values. Any exception is an owner gate.

### 4.4 Live suite (opt-in, nightly)
- Ollama + OpenRouter config: a dead first provider (closed localhost port) falls back to Ollama.
- The long-context route sends an over-threshold request to OpenRouter (asserted via
  `x-babelgate-provider`).
- Existing cases unchanged.

### 4.5 Release gates
1. Claude Code edit gate on rented-GPU Ollama, `qwen3-coder:30b` (D4), per `docs/gates/gpu-ollama.md`.
2. Claude Code edit gate with `examples/claude-code-hybrid.yaml` (OpenRouter key required).
3. A clean live run of the Gemini target (fresh quota or paid tier).

## 5. Task outline (the plan will detail these)
| # | Task | Gate |
|---|---|---|
| 1 | Refactor: registry, explicit service inputs, split `proxy.service`; no behaviour change, tests untouched | |
| 2 | `detectSource`; all formats on one port; `SOURCE_API` deprecated | interface |
| 3 | `rules` + `planRoute` (explicit, aliases, routes, `when`, default); `MODEL_MAP` → routes | |
| 4 | YAML config, schema, discovery, env precedence, routing table output | OWNER GATE (new dependency `yaml`) |
| 5 | `attempt-targets` + fallbacks (JSON and stream), `x-babelgate-*` headers, route log line | |
| 6 | Merged model list + 60 s cache | |
| 7 | CLI: `--config`, endpoints block, presets with a config file | OWNER GATE |
| 8 | Examples, recipes, README | |
| 9 | Live-suite multi-provider cases | OWNER REVIEW |
| 10 | GPU gate runbook; gate runs (§4.5); Gemini live run | OWNER REVIEW |
| 11 | CHANGELOG, roadmap, `1.2.0` | OWNER GATE |

## 6. Owner decisions (2026-10-29)
| # | Decision | Chosen |
|---|---|---|
| D1 | Scope | Roadmap v1.2 gateway in full + Claude Code long-context routing + v1.1 gate gaps as release gates |
| D2 | Unmatched model | Default provider, model unchanged; no built-in prefix routing |
| D3 | Multi-provider config | YAML for ≥ 2 providers, env for one; keys referenced by env var name only |
| D4 | Claude Code ↔ Ollama gate | Rented GPU per release; the owner's laptop is not a gate machine |
| D5 | Architecture | Thin routing layer in front of the existing pipeline (approach 1) |
| D6 | New dependency | `yaml` (eemeli/yaml) |

**Owner actions:** approve the `yaml` dependency (task 4); keep `OPENROUTER_API_KEY` funded for live cases
and gate 2; rent the GPU host and run gate 1; provide a Gemini key with fresh quota for gate 3; tag
`v1.2.0` and publish.

## 7. Risks
| Risk | Mitigation |
|---|---|
| The refactor breaks something subtle | Task 1 is behaviour-neutral with the suite untouched (§4.3) |
| `anthropic-version` is not always sent | Verified against SDK source in task 2; `x-api-key` tie-break |
| Fallbacks hide a failing provider | Every hop logged; `x-babelgate-attempts`; 401/403 never fall back |
| Provider names collide with model prefixes | Provider names win; documented; alias/provider name clash is a startup error |
| Supply-chain risk from `yaml` | Zero-dependency package; owner gate |
| Per-provider timeouts drift from defaults | Defaults unchanged; overrides only |
| Large upstream model lists (OpenRouter 300+) slow `/v1/models` | Parallel fetch + 60 s cache |
| Scope creep | §2.2 stands; anything else is a follow-up |
