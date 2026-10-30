# v1.2 Task 2 — conductor notes

- **Named expected-value changes only.** The plan's Step 2 list is the complete set of existing-test changes
  this task may make (count_tokens 200 on any target; the two env-config messages; `sourceApi` assertions
  removed; `SOURCE_API` dropped from the two cli.test.ts expected objects and the override list;
  resolve-source.test.ts deleted with its four path cases carried over), plus the three owner-approved
  changes below. Any other existing assertion that has to change → STOP and report it. List every change
  old → new in the PR body.
- **Owner decision 2026-10-29 (option A): three more named changes, approved.** These count as named
  changes; the PR body and the decisions entry list them old → new, marked "approved by the owner,
  conductor escalation option A":
  1. `tests/integration/pairs.test.ts` "$source → $target proxies GET /models end-to-end": for
     `source === "anthropic"`, send `anthropic-version: 2023-06-01`. No check or expected value changes.
  2. `tests/integration/pairs.test.ts` "returns 404 when path does not match source provider": delete it
     (spec §3.8: other formats' paths now answer). Its 404 coverage stays in "returns 404 for GET chat paths"
     and `proxy.test.ts` "returns 404 for unmapped paths".
  3. `src/services/proxy.service.test.ts`: pass `{ source: "<provider>" }` to each `proxyRequest()` call,
     matching that test's path; assertions unchanged. Record this file and `pairs.test.ts` under "Files
     outside the Files block" in docs/decisions.md.
- **Step 0 evidence first.** Cite the `@anthropic-ai/sdk` file/line in node_modules showing `anthropic-version`
  is always sent, plus Claude Code's gateway docs URL and date, in the decisions entry. If not always sent,
  implement the spec's tie-break and say so. Already confirmed by the conductor:
  `@anthropic-ai/sdk@0.132.1` `node_modules/@anthropic-ai/sdk/client.js:842` always sets
  `anthropic-version: 2023-06-01`.
- One real request per client format against `npm run dev` in the PR body (step 9a). (Source: plan.)
