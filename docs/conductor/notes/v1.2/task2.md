# v1.2 Task 2 — conductor notes

- **Named expected-value changes only.** The plan's Step 2 list is the complete set of existing-test changes
  this task may make (count_tokens 200 on any target; the two env-config messages; `sourceApi` assertions
  removed; `SOURCE_API` dropped from the two cli.test.ts expected objects and the override list;
  resolve-source.test.ts deleted with its four path cases carried over). Any other existing assertion that
  has to change → STOP and report it. List every change old → new in the PR body.
- **Step 0 evidence first.** Cite the `@anthropic-ai/sdk` file/line in node_modules showing `anthropic-version`
  is always sent, plus Claude Code's gateway docs URL and date, in the decisions entry. If not always sent,
  implement the spec's tie-break and say so.
- One real request per client format against `npm run dev` in the PR body (step 9a). (Source: plan.)
