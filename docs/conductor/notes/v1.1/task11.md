# v1.1 Task 11 — conductor notes

- **Anthropic stream `message_start` input tokens.** Since Task 5, the Anthropic stream encoder sends
  `message_start.message.usage` as `{input_tokens: 0, output_tokens: 0}`. The real counts arrive only in the
  final `message_delta`, because the canonical `message_start` event carries no usage (spec §3.1), and
  Ollama reports `prompt_eval_count` only on its `done: true` line. Claude Code reads `message_start` usage
  for its context display. In this task, set `message_start.message.usage.input_tokens` from
  `estimateInputTokens(canonicalRequest)`, passed to the encoder through its context. Do not add usage to
  the canonical `message_start` event: that would be an interface change and needs an owner decision.
  Keep the final `message_delta` carrying the real upstream counts. Test the pair
  `"anthropic → ollama stream:true message_start carries the estimate"`.
  - If passing the estimate needs a new field on `StreamEncoderContext` (a canonical type), stop and
    report it as an interface change; don't add it on your own. (Source: owner, PR #18 discussion,
    2026-10-27.)
