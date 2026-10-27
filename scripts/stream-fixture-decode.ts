/**
 * stream-fixture-decode.ts — per-provider generators: raw recorded stream
 * bytes -> CanonicalStreamEvent[], following the conventions recorded in
 * docs/decisions.md ("v1.1 Task 3"):
 *
 *  - generated IDs come from a fresh sequentialIds() in emission order;
 *    wire IDs are used when present (OpenAI chatcmpl-/call_…, Anthropic
 *    msg_…/toolu_…, Gemini responseId, Ollama call_…), else call_<n>.
 *  - empty text/argument strings produce no delta events.
 *  - OpenAI/Anthropic argumentsDelta = the wire strings; Gemini/Ollama send
 *    argument objects, so argumentsDelta is JSON.stringify of the object.
 *  - usage is emitted once, before message_end.
 *  - message_end.finishReason is canonical.
 *
 * Anything the conventions don't cover throws FixtureAmbiguity — the
 * caller reports it as STOP and writes nothing.
 */
import {
  kindFromStatus,
  makeCanonicalError,
} from "../src/utils/canonical-error";
import type {
  CanonicalFinishReason,
  CanonicalStreamEvent,
  CanonicalUsage,
} from "../src/types/canonical.types";

export class FixtureAmbiguity extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Obj = Record<string, any>;

/**
 * Iterate a provider SSE capture event by event. Every `data:` line is a
 * complete payload (all four providers send single-line JSON data); an
 * `event:` line names the next data line; `:` comments and blank lines are
 * framing. Blank-line-separated captures and bare `data:` line captures
 * (e.g. the openai-go recording) both work.
 */
export function parseSseBlocks(
  text: string,
): { event?: string; data: string }[] {
  const blocks: { event?: string; data: string }[] = [];
  let event: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) {
      if (line === "") event = undefined;
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
      continue;
    }
    if (line.startsWith("data:")) {
      blocks.push({ event, data: line.slice(5).trimStart() });
      event = undefined;
    }
  }
  return blocks;
}

function usageEvent(
  inputTokens: number,
  outputTokens: number,
  totalTokens?: number,
): CanonicalStreamEvent {
  return {
    type: "usage",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: totalTokens ?? inputTokens + outputTokens,
    },
  };
}

// ---------- OpenAI ----------

const OPENAI_FINISH: Record<string, CanonicalFinishReason> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_call",
  function_call: "tool_call",
  content_filter: "content_filter",
};

export function openaiEvents(
  text: string,
  model: string,
  ids: () => string,
): CanonicalStreamEvent[] {
  const events: CanonicalStreamEvent[] = [];
  let started = false;
  let finish: CanonicalFinishReason | undefined;
  let usage: CanonicalUsage | undefined;
  let nextIndex = 0;
  // wire tool_calls[].index -> canonical index, in first-appearance order
  const calls = new Map<number, number>();
  const open: number[] = [];

  const closeAll = () => {
    for (const i of open.splice(0)) {
      events.push({ type: "tool_call_end", index: i });
    }
  };

  for (const { data } of parseSseBlocks(text)) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as Obj;
    if (chunk.error) {
      throw new FixtureAmbiguity(
        `openai stream carried an in-stream error object (${JSON.stringify(
          chunk.error.type ?? chunk.error.code ?? "?",
        )}): no recorded convention maps it to a canonical kind`,
      );
    }
    if (!started) {
      started = true;
      events.push({
        type: "message_start",
        id: typeof chunk.id === "string" ? chunk.id : ids(),
        model: typeof chunk.model === "string" ? chunk.model : model,
      });
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (typeof delta?.content === "string" && delta.content.length > 0) {
        events.push({ type: "text_delta", text: delta.content });
      }
      for (const tc of delta?.tool_calls ?? []) {
        const wireIndex = typeof tc.index === "number" ? tc.index : 0;
        let index = calls.get(wireIndex);
        if (index === undefined) {
          index = nextIndex++;
          calls.set(wireIndex, index);
          open.push(index);
          events.push({
            type: "tool_call_start",
            index,
            id: typeof tc.id === "string" ? tc.id : ids(),
            name: tc.function?.name ?? "",
          });
        }
        if (
          typeof tc.function?.arguments === "string" &&
          tc.function.arguments.length > 0
        ) {
          events.push({
            type: "tool_call_delta",
            index,
            argumentsDelta: tc.function.arguments,
          });
        }
      }
      if (choice.finish_reason && finish === undefined) {
        finish = OPENAI_FINISH[choice.finish_reason as string];
        if (finish === undefined) {
          throw new FixtureAmbiguity(
            `openai finish_reason "${choice.finish_reason}" has no canonical mapping`,
          );
        }
        closeAll();
      }
    }
    if (chunk.usage && usage === undefined) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens:
          chunk.usage.total_tokens ??
          (chunk.usage.prompt_tokens ?? 0) +
            (chunk.usage.completion_tokens ?? 0),
      };
    }
  }
  if (!started) throw new FixtureAmbiguity("openai stream had no chunks");
  closeAll();
  if (usage) events.push({ type: "usage", usage });
  events.push({ type: "message_end", finishReason: finish ?? "unknown" });
  return events;
}

// ---------- Anthropic ----------

const ANTHROPIC_STOP: Record<string, CanonicalFinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_call",
  refusal: "content_filter",
};

/** Anthropic wire error types carry their HTTP status (docs.claude.com). */
const ANTHROPIC_ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large_error: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

export function anthropicEvents(
  text: string,
  model: string,
  ids: () => string,
): CanonicalStreamEvent[] {
  const events: CanonicalStreamEvent[] = [];
  let started = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: CanonicalFinishReason | undefined;
  let nextIndex = 0;
  const toolBlocks = new Map<number, number>();

  const flush = () => {
    events.push(usageEvent(inputTokens, outputTokens));
    events.push({ type: "message_end", finishReason: stopReason ?? "unknown" });
  };

  for (const { data } of parseSseBlocks(text)) {
    const msg = JSON.parse(data) as Obj;
    switch (msg.type) {
      case "message_start":
        started = true;
        events.push({
          type: "message_start",
          id: typeof msg.message?.id === "string" ? msg.message.id : ids(),
          model:
            typeof msg.message?.model === "string" ? msg.message.model : model,
        });
        inputTokens = msg.message?.usage?.input_tokens ?? 0;
        outputTokens = msg.message?.usage?.output_tokens ?? 0;
        break;
      case "content_block_start":
        if (msg.content_block?.type === "tool_use") {
          const index = nextIndex++;
          toolBlocks.set(msg.index, index);
          events.push({
            type: "tool_call_start",
            index,
            id:
              typeof msg.content_block.id === "string"
                ? msg.content_block.id
                : ids(),
            name: msg.content_block.name ?? "",
          });
        }
        break;
      case "content_block_delta":
        if (msg.delta?.type === "text_delta" && msg.delta.text) {
          events.push({ type: "text_delta", text: msg.delta.text });
        } else if (
          msg.delta?.type === "input_json_delta" &&
          msg.delta.partial_json
        ) {
          const index = toolBlocks.get(msg.index);
          if (index === undefined) {
            throw new FixtureAmbiguity(
              `anthropic input_json_delta on block ${msg.index} with no open tool call`,
            );
          }
          events.push({
            type: "tool_call_delta",
            index,
            argumentsDelta: msg.delta.partial_json,
          });
        }
        break;
      case "content_block_stop": {
        const index = toolBlocks.get(msg.index);
        if (index !== undefined) {
          events.push({ type: "tool_call_end", index });
          toolBlocks.delete(msg.index);
        }
        break;
      }
      case "message_delta": {
        if (msg.usage?.output_tokens !== undefined) {
          outputTokens = msg.usage.output_tokens;
        }
        const sr = msg.delta?.stop_reason;
        if (sr) {
          stopReason = ANTHROPIC_STOP[sr as string];
          if (stopReason === undefined) {
            throw new FixtureAmbiguity(
              `anthropic stop_reason "${sr}" has no canonical mapping`,
            );
          }
        }
        break;
      }
      case "error": {
        const wireType = msg.error?.type;
        const status = ANTHROPIC_ERROR_STATUS[wireType as string];
        if (status === undefined) {
          throw new FixtureAmbiguity(
            `anthropic in-stream error type "${wireType}" has no recorded kind mapping`,
          );
        }
        events.push({
          type: "error",
          error: makeCanonicalError(
            kindFromStatus(status),
            typeof msg.error?.message === "string"
              ? msg.error.message
              : "anthropic stream error",
          ),
        });
        return events;
      }
      case "message_stop":
        if (started) flush();
        return events;
      case "ping":
        break;
      default:
        break; // unknown block types carry no canonical events
    }
  }
  if (started) flush();
  return events;
}

// ---------- Gemini ----------

const GEMINI_FINISH: Record<string, CanonicalFinishReason> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  BLOCKLIST: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  SPII: "content_filter",
};

export function geminiEvents(
  text: string,
  model: string,
  ids: () => string,
): CanonicalStreamEvent[] {
  const events: CanonicalStreamEvent[] = [];
  let started = false;
  let finish: CanonicalFinishReason | undefined;
  let usage: CanonicalUsage | undefined;
  let nextIndex = 0;
  let sawToolCall = false;

  for (const { data } of parseSseBlocks(text)) {
    const res = JSON.parse(data) as Obj;
    if (res.error) {
      const code = typeof res.error.code === "number" ? res.error.code : NaN;
      if (Number.isNaN(code)) {
        throw new FixtureAmbiguity(
          "gemini in-stream error object without a numeric code",
        );
      }
      events.push({
        type: "error",
        error: makeCanonicalError(
          kindFromStatus(code),
          typeof res.error.message === "string"
            ? res.error.message
            : "gemini stream error",
        ),
      });
      return events;
    }
    if (!started) {
      started = true;
      events.push({
        type: "message_start",
        id: typeof res.responseId === "string" ? res.responseId : ids(),
        model:
          typeof res.modelVersion === "string" ? res.modelVersion : model,
      });
    }
    for (const cand of res.candidates ?? []) {
      for (const part of cand.content?.parts ?? []) {
        if (part.thought === true) continue; // thinking parts are not user text
        if (typeof part.text === "string" && part.text.length > 0) {
          events.push({ type: "text_delta", text: part.text });
        }
        if (part.functionCall) {
          const index = nextIndex++;
          sawToolCall = true;
          events.push({
            type: "tool_call_start",
            index,
            id:
              typeof part.functionCall.id === "string"
                ? part.functionCall.id
                : ids(),
            name: part.functionCall.name ?? "",
          });
          events.push({
            type: "tool_call_delta",
            index,
            argumentsDelta: JSON.stringify(part.functionCall.args ?? {}),
          });
          events.push({ type: "tool_call_end", index });
        }
      }
      if (cand.finishReason && finish === undefined) {
        finish = GEMINI_FINISH[cand.finishReason as string];
        if (finish === undefined) {
          throw new FixtureAmbiguity(
            `gemini finishReason "${cand.finishReason}" has no canonical mapping`,
          );
        }
      }
    }
    if (res.usageMetadata) {
      usage = {
        inputTokens: res.usageMetadata.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens:
          res.usageMetadata.totalTokenCount ??
          (res.usageMetadata.promptTokenCount ?? 0) +
            (res.usageMetadata.candidatesTokenCount ?? 0),
      };
    }
  }
  if (!started) throw new FixtureAmbiguity("gemini stream had no chunks");
  if (usage) events.push({ type: "usage", usage });
  // A stream that ends in tool calls reports tool_call (wire says STOP).
  const finishReason: CanonicalFinishReason = sawToolCall
    ? "tool_call"
    : (finish ?? "unknown");
  events.push({ type: "message_end", finishReason });
  return events;
}

// ---------- Ollama ----------

export function ollamaEvents(
  text: string,
  model: string,
  ids: () => string,
): CanonicalStreamEvent[] {
  const events: CanonicalStreamEvent[] = [];
  let started = false;
  let sawToolCall = false;
  let nextIndex = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = JSON.parse(trimmed) as Obj;
    if (typeof obj.error === "string" && obj.error.length > 0) {
      // Mid-stream failure: HTTP status already 200 and the wire carries no
      // code — the generation itself failed server-side.
      events.push({
        type: "error",
        error: { kind: "internal", status: 500, message: obj.error },
      });
      return events;
    }
    if (!started) {
      started = true;
      events.push({
        type: "message_start",
        id: ids(),
        model: typeof obj.model === "string" ? obj.model : model,
      });
    }
    if (typeof obj.message?.content === "string" && obj.message.content) {
      events.push({ type: "text_delta", text: obj.message.content });
    }
    for (const tc of obj.message?.tool_calls ?? []) {
      const index = nextIndex++;
      sawToolCall = true;
      events.push({
        type: "tool_call_start",
        index,
        id: typeof tc.id === "string" ? tc.id : ids(),
        name: tc.function?.name ?? "",
      });
      events.push({
        type: "tool_call_delta",
        index,
        argumentsDelta: JSON.stringify(tc.function?.arguments ?? {}),
      });
      events.push({ type: "tool_call_end", index });
    }
    if (obj.done === true) {
      if (
        obj.prompt_eval_count !== undefined ||
        obj.eval_count !== undefined
      ) {
        events.push(
          usageEvent(obj.prompt_eval_count ?? 0, obj.eval_count ?? 0),
        );
      }
      const reason = obj.done_reason;
      const finish: CanonicalFinishReason = sawToolCall
        ? "tool_call"
        : reason === "length"
          ? "length"
          : reason === "stop"
            ? "stop"
            : "unknown";
      events.push({ type: "message_end", finishReason: finish });
      return events;
    }
  }
  if (!started) throw new FixtureAmbiguity("ollama stream had no lines");
  throw new FixtureAmbiguity(
    "ollama stream ended without done:true or an error line (truncated)",
  );
}
