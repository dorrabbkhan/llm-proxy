# Decisions & deviations log

One entry per decision or per task that deviated from the plan or spec. Newest at the bottom.

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
