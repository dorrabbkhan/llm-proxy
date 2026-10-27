# AGENTS.md — llm-proxy

llm-proxy is a TypeScript / Express 5 proxy that translates between LLM API formats (OpenAI, Gemini,
Ollama, Anthropic) through a canonical intermediate format: one adapter per provider, never one
transformer per provider pair.

**The source of truth is the spec named on your plan's `**Spec:**` line** (under
`docs/superpowers/specs/`), with `docs/roadmap.md` for direction. Read the spec sections relevant to your
task before writing code. If the spec and this file disagree, the spec wins. If the spec is ambiguous or
seems wrong, stop and ask. Do not guess.

## Commands

- **`./scripts/check.sh quick` — the iteration gate.** Fixture guard + typecheck always; `vitest --changed`
  for tests touched by your changes.
- **`./scripts/check.sh` — the full local gate; run it once before every push.** Fixture guard, typecheck,
  the whole test suite, and the production build.
- Install: `npm ci`
- Tests: `npm test` (all), `npx vitest run <path>` (one file)
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Run locally: `cp .env.example .env`, fill it in, `npm run dev`

## Hard rules

1. **Fixtures are the oracle.** Never hand-edit `tests/fixtures/` or `tests/contracts/__snapshots__/`, and
   never change them in the same PR as adapter code unless the task explicitly says so. If a contract or
   fixture test fails, assume the adapter is wrong. Never run `vitest -u` and never set
   `ALLOW_FIXTURE_CHANGE`; only the human does.
2. Tests ship in the same PR as the code they test. For adapter and service code, write the test first.
3. **Adapters only convert between their own provider and canonical.** An adapter never imports another
   adapter, and no code may special-case a provider *pair*. If a pair needs special handling, the canonical
   format is missing something: stop and report.
4. Changes to `src/types/canonical.types.ts` must update `src/types/canonical.schema.ts` in the same commit
   and be recorded in `docs/decisions.md`. Canonical changes are interface changes: only make the ones the
   task names.
5. **No network in `npm test`.** Upstreams are mocked with msw (`tests/mocks/upstreams.ts`). Real provider
   calls belong only in the opt-in live suite.
6. Never log, store or echo prompt bodies, completions or API keys, and never put an upstream key in an
   error message.
7. Keep files single-purpose and under ~400 lines. If a task makes a file grow past that, split it as part
   of the task and record it in `docs/decisions.md`.
8. Do not add runtime dependencies beyond those named in the plan without saying why in the PR
   description. Provider SDKs stay `devDependencies` (type-only imports).
9. After editing, verify every changed file with `git diff` before committing. If a write didn't land,
   rewrite the whole file and re-verify.
10. Never commit `dist/`, `.env` or real API keys. Never weaken an error path to make a test pass:
    unsupported features fail with a clear error shaped like the source provider's errors.

## Workflow

- One task per branch. Name the branch `v<version>/task-<N>-<short-name>`, e.g. `v1.1/task-3-anthropic-sse`.
- Iterate with `./scripts/check.sh quick`; run the full `./scripts/check.sh` once before pushing. Do not
  disable, skip or loosen tests to make it pass.
- Push the task branch and open a PR with `gh pr create`; the PR body is the Final summary.
- After `gh pr create`, start `scripts/llm-proxy-loop.sh watch` (backgrounds the check watch) and block on
  `scripts/llm-proxy-loop.sh await` only before the final summary. Don't review your own PR or post reviews
  or comments on it; the conductor runs the independent review in a fresh session.
- The PR is done when all GitHub checks are green. Never merge; the human merges.
- Final summary: the spec sections implemented, the tests added, and anything ambiguous you resolved.
- Record any deviation from the task's Files block, interfaces or spec in `docs/decisions.md`
  (one entry per task) in the same PR.
- Stay inside the task's scope. Note follow-ups in the PR description instead of doing them.

## Layout

- `src/routes/`: thin HTTP adapters; delegate to services
- `src/services/`: orchestration (`proxy.service.ts`) and upstream transport (`http-client.ts`)
- `src/transformers/adapters/`: one file per provider, plus `PROVIDER_ROUTES` in `index.ts`
- `src/types/`: canonical types and Zod schemas; provider types (mostly SDK re-exports)
- `src/config/`, `src/middleware/`, `src/utils/`: env config, Express middleware, logger and errors
- `tests/contracts/`: schema, fixture-golden and wiring tests — the guarantee that pairs compose
- `tests/integration/`: supertest + msw end-to-end tests, generated per provider pair
- `tests/fixtures/`: realistic provider payloads (the oracle)
