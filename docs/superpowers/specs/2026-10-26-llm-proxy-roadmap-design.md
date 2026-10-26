# llm-proxy roadmap — Design Spec

**Date:** 2026-10-26 · **Status:** approved in brainstorming, awaiting written review ·
**Roadmap:** `docs/roadmap.md`

## 1. Purpose

Decide what llm-proxy is for, who it serves in what order, how it can make money, and what must happen
next versus later. This spec records the reasoning; `docs/roadmap.md` is the plan derived from it. Each
version on the roadmap gets its own spec → plan → implementation cycle; this document does not specify
any version in implementation detail.

Priorities, in the owner's words: usability for people, usefulness, ease of use, feature-fullness and
potential monetization.

## 2. Current standing (v1.0, 2026-10-26)

### 2.1 What exists
- TypeScript / Express 5 proxy translating between OpenAI, Gemini, Ollama and Anthropic through a
  canonical intermediate format: one adapter per provider instead of a transformer per pair.
- Chat and model-list endpoints; one source→target pair per instance, configured by env vars.
- Upstream timeout and retry, optional client bearer auth, pino logging with per-request token usage,
  multi-stage Docker image.
- 315 tests in under 2 seconds: adapter unit tests, Zod contract tests on canonical output,
  fixture-driven golden tests, and HTTP integration tests across all 16 provider pairs with msw-mocked
  upstreams.
- ~2,900 lines of non-test source; clean layering (routes → services → transformers → adapters).

### 2.2 Gaps found
| Gap | Evidence | Impact |
|---|---|---|
| Ollama streams by default; proxy expects JSON | `ollama.adapter.ts` omits `stream` when the client did; `http-client.ts` calls `res.json()`; mocks always return JSON | README quick-start likely broken against real Ollama (to confirm in v1.0.1) |
| Streaming not translated | README known limitations; `stream: true` forwarded, SSE reply not parsed | Most chat UIs and SDKs stream by default |
| Tool calling only in the OpenAI adapter | Gemini adapter has no tool handling; Anthropic and Ollama only map the finish reason; `CanonicalToolChoice` unused | Agent clients (Claude Code, Cursor, LangChain agents) fail across most pairs |
| One pair per instance | `SOURCE_API` / `TARGET_API` | No "one endpoint, many providers" |
| No usage aggregation, cost, UI | logs only | Users can't see what the proxy is doing |
| No licence file, CI or published artifact | repo listing; `package.json` says ISC with no author | Others can't easily adopt or contribute |
| Tests never touch real upstreams | msw everywhere | The class of bug in row 1 is invisible |

### 2.3 Strengths worth keeping
- The canonical design makes features cost **per adapter, not per pair**: streaming and tools for all
  16 pairs is four adapters' worth of work.
- Contract tests make pairs compose by construction. That is the quality claim competitors can't easily
  make, and it carries forward into every version.

## 3. Audience and sequencing

The owner wants to serve individuals, self-hosting developers, teams, possibly a hosted offering, and
portfolio value. Serving all at once serves none, so each phase has a primary audience:

| Phase | Primary audience | Why this order |
|---|---|---|
| 1–2 (v1.0.1–v1.5) | Individuals, power users with local models, self-hosting developers | Adoption comes from them; they need correctness and zero-friction setup, not governance |
| 3 (v2.x) | Small teams found through Phase 1–2 users: AI startups, agencies, homelab groups | Teams hit "shared keys, no budgets" — the natural paid boundary |
| 4 (v3.0) | Teams that want a managed dashboard | Only if Phase 3 shows demand |
| Throughout | Portfolio value | Comes from the validation discipline; shapes how, not what |

adnymics is explicitly **not** a pilot or a target.

### 3.1 Flawless experiences
Chosen by the owner, in priority order of the roadmap:
1. **Claude Code on anything** — Anthropic-format client, any backend, streaming and tools.
2. **Any OpenAI-format app, any backend** — Open WebUI, Cursor, LangChain, the OpenAI SDK.
3. **One endpoint, many providers** — routing by model name, aliases, fallbacks.

A fourth candidate, "Gemini or Anthropic SDK code on another backend for tests and CI", was not chosen
as a headline; it falls out of v1.1 + v1.5's response cache at little extra cost.

## 4. Positioning

### 4.1 Landscape
| Tool | Shape | Where llm-proxy differs |
|---|---|---|
| LiteLLM | Large Python gateway, OpenAI-format in, many providers out | llm-proxy accepts every supported format *in*, not just OpenAI; small, typed and contract-tested |
| OpenRouter | Hosted token reseller | Self-hosted; no reselling (non-goal) |
| Portkey, Helicone | Hosted/OSS gateways and observability | Lighter; local-first; translation inspector |
| claude-code-router and similar | Single-purpose Claude Code shims | General gateway with the same hook as its entry point |
| Cloudflare AI Gateway | Managed edge gateway | Runs anywhere, including fully offline with Ollama |
| Ollama's OpenAI compatibility | One provider, OpenAI format only | Any format, any provider, routing and fallbacks |

### 4.2 The claim
**A small, typed, contract-tested gateway that translates any client format to any provider, running in
one command.** Breadth follows depth: we copy what's table stakes and don't race LiteLLM on provider count.
OpenAI-compatible targets (v1.2) cover the long tail as config, not code.

## 5. Approaches considered

1. **Hook first, then broaden (chosen).** v1.1 delivers Claude Code on anything with streaming and tools
   in all adapters, then launches; v1.2 adds the gateway; v1.3 visibility; later breadth and teams.
   The canonical design makes "all pairs" only modestly more work than one pair, so the hook costs little
   extra and gives a demonstrable launch in about a quarter.
2. **Gateway first.** Lead with routing, keys and a dashboard. Rejected: it launches without streaming or
   tools, which all three flawless experiences need, and fights LiteLLM on its own ground.
3. **Fully correct translation first.** Streaming, tools, embeddings, structured output, reasoning,
   caching, media and the Responses API before any gateway feature. Rejected: about six months with
   nothing a user would switch for and no launch moment.

## 6. Business model and licence

- **Open core.** The core is **Apache-2.0**. Permissive licensing wins early users in a crowded developer
  market; AGPL (NeoPhylo's choice) would put off the companies Phase 3 sells to.
- **CLA from the first outside contribution**, so relicensing stays possible.
- **The paid boundary is team governance:** virtual keys, budgets, audit, SSO, policies, per-team
  routing and evals. These live in `@llm-proxy/team`, a commercial package in a private repo that
  depends only on the public plugin API (v2.0). The core never contains private code.
- **Free stays generous:** multiple labelled keys, per-key usage, cost tracking, UI, routing, fallbacks
  and cache are all open. Individuals and homelabs never hit a paywall.
- **Gate:** v2.1 (the first paid release) is built only after 3 teams commit via LOI, pre-order or
  design-partner agreement. Until then the offer is the v2.0 hooks plus a waitlist.
- **Pricing sketch** (to confirm in the v2.1 spec): Team ~$20–30 per active user per month or ~$200/month
  flat per instance under 25 users; Enterprise custom (~$10k+/year); paid support from v1.5.
- **Hosted:** at most a metadata-only control plane (v3.0). Never a token reseller.

## 7. Repository visibility

- The core repo is **already public** with 0 stars. A history scan (2026-10-26) found no committed
  `.env` and no API-key patterns. It stays public; making it private would gain nothing.
- **Public is not announced.** The repo is public now; the announcement waits for v1.1.
- The CLA bot must be active before the first outside PR is merged.
- `llm-proxy-team` is private from creation (start of v2.1). The hosted control plane, if built, is
  private.
- Specs, plans and decisions for open features live publicly in `docs/`. Pricing details and customer
  notes live in the private repo.

## 8. Engineering principles carried through every version

- **One spec → plan → agent cycle per version**, sized S/M/L for part-time agent-driven work (S ≈ 2–3
  weeks, M ≈ 4–6 weeks, L ≈ 2–3 months).
- **Validation discipline:** adapter contract tests; fixture corpora recorded from real SDKs; pair tests
  across every source × target; a live smoke suite against real upstreams (from v1.0.1); streaming
  property test (stream reassembles to the non-streaming canonical response, from v1.1).
- **Fail honestly in the client's dialect:** unsupported features return a clear error shaped like the
  source provider's errors (e.g. `501` for embeddings on Anthropic), never a crash or silent drop.
- **Privacy by default:** prompt bodies are never persisted unless explicitly enabled.
- **Config is optional:** env vars cover the single-target case; `llm-proxy.yaml` appears only when
  routing needs it (v1.2).
- **A decisions log** (`docs/decisions.md`) records every deviation from a plan or spec.

## 9. Success criteria and gates

| Point | Criterion |
|---|---|
| v1.0.1 | Quick-start verified against live Ollama; CI green; licence and CLA in place |
| v1.1 | Claude Code completes a real edit task through the proxy on Ollama; streaming × tools pair tests pass for all 16 pairs; launched publicly |
| v1.5 (🟢) | 2k stars; listed in Ollama, Open WebUI and Claude Code community docs; 10+ outside contributors; first teams asking for keys and budgets |
| Before v2.1 (💰) | 3 committed teams, or the paid tier isn't built |
| Before v3.0 (☁️) | Paying teams asking for a managed dashboard |

## 10. Non-goals

- Reselling tokens or operating an OpenRouter-style marketplace.
- Racing LiteLLM on provider count; the long tail is OpenAI-compatible config.
- Fine-tuning, model hosting or inference.
- Storing prompts by default.
- Building team features before the gate is met.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Streamed tool-call translation (especially Anthropic ↔ Gemini) is harder than estimated | Fixture corpus recorded from real SDKs first; property test; v1.1 sized L; may split into v1.1 streaming / v1.2 tools if the spec finds it too big |
| Provider APIs change under us | Nightly live smoke suite; SDK type re-exports catch shape drift at compile time |
| A competitor ships the same hook first | Launch at v1.1 rather than after the gateway; differentiate on correctness and the translation inspector |
| Part-time capacity shared with NeoPhylo | Re-plan after every release; gates prevent premature paid work |
| A fork takes the core | Apache-2.0 accepted knowingly; paid value is governance in a separate package |

## 12. Open questions for later specs

- v1.5: single binary (Node SEA vs Bun compile) or a tray app.
- v2.1: final pricing and how licence keys are checked offline.
- Whether to rename the project before launch, since "llm-proxy" is a crowded name on npm and GitHub
  (decide before v1.1 publishes the npm package).
