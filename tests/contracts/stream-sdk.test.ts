import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  openaiAdapter,
  anthropicAdapter,
} from "../../src/transformers/adapters";
import { mapToAnthropicStopReason } from "../../src/transformers/adapters/anthropic.adapter";
import { reassembleStream } from "../../src/utils/stream-reassemble";
import type { CanonicalStreamEvent } from "../../src/types/canonical.types";
import type { ChatCompletionRequest } from "../../src/types/openai.types";
import type {
  MessageCreateParams,
  TextBlock,
  ToolUseBlock,
} from "../../src/types/anthropic.types";

/**
 * Encoder contract (spec §3.3, §4.2): bytes our encoders write must be
 * parseable by the provider's own SDK — the strongest guarantee the wire
 * format is right, independent of our own decoder.
 *
 * Rows are generated per provider and case; a provider joins when its
 * encoder lands (Tasks 4–7).
 *
 * The bytes are served over a real loopback HTTP server rather than msw:
 * the OpenAI SDK calls reader.cancel() when it sees `[DONE]`, and the
 * cancellation never resolves on msw's synthetic response stream.
 */
const STREAMS_DIR = join(__dirname, "..", "fixtures", "streams");

interface StreamFixture {
  model: string;
  expectedEvents: CanonicalStreamEvent[];
}

function fixtureFor(provider: string, name: string): StreamFixture {
  return JSON.parse(
    readFileSync(join(STREAMS_DIR, provider, `${name}.json`), "utf8"),
  ) as StreamFixture;
}

const openaiCases = readdirSync(join(STREAMS_DIR, "openai"))
  .filter((f) => f.endsWith(".json") && !f.endsWith(".nonstreaming.json"))
  .map((f) => f.slice(0, -".json".length));

// "error" has no message to accumulate — covered by the error-event test.
const anthropicCases = readdirSync(join(STREAMS_DIR, "anthropic"))
  .filter((f) => f.endsWith(".json") && !f.endsWith(".nonstreaming.json"))
  .map((f) => f.slice(0, -".json".length))
  .filter((name) => name !== "error");

function encodeOpenai(
  fixture: StreamFixture,
  sourceRequest: ChatCompletionRequest,
): string {
  const encoder = openaiAdapter.createStreamEncoder({
    sourceRequest,
    query: {},
    requestedModel: "m",
  });
  let out = "";
  for (const event of fixture.expectedEvents) out += encoder.encode(event);
  return out + encoder.end();
}

const STREAMING_REQUEST: ChatCompletionRequest = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
  stream_options: { include_usage: true },
};

function encodeAnthropic(
  events: CanonicalStreamEvent[],
  sourceRequest: MessageCreateParams,
): string {
  const encoder = anthropicAdapter.createStreamEncoder({
    sourceRequest,
    query: {},
    requestedModel: "m",
  });
  let out = "";
  for (const event of events) out += encoder.encode(event);
  return out + encoder.end();
}

const ANTHROPIC_STREAMING_REQUEST: MessageCreateParams = {
  model: "m",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
  stream: true,
};

const ANTHROPIC_STREAM_PARAMS = {
  model: "m",
  max_tokens: 1024,
  messages: [{ role: "user" as const, content: "hi" }],
};

let currentBody = "";
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(currentBody);
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
});
afterAll(() => {
  server.close();
});

function sdkClient(): OpenAI {
  const port = (server.address() as AddressInfo).port;
  return new OpenAI({
    apiKey: "test-key",
    baseURL: `http://127.0.0.1:${port}/v1`,
    maxRetries: 0,
  });
}

function anthropicClient(): Anthropic {
  const port = (server.address() as AddressInfo).port;
  return new Anthropic({
    apiKey: "test-key",
    baseURL: `http://127.0.0.1:${port}`,
    maxRetries: 0,
  });
}

describe("stream encoders via the provider SDK", () => {
  it.each(openaiCases)("openai SDK parses encoded %s", async (name) => {
    const fixture = fixtureFor("openai", name);
    currentBody = encodeOpenai(fixture, STREAMING_REQUEST);

    const runner = sdkClient().chat.completions.stream({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const _chunk of runner) {
      // consume the whole stream
    }
    const final = await runner.finalChatCompletion();

    const expected = reassembleStream(fixture.expectedEvents);
    const choice = final.choices[0]!;

    expect(choice.finish_reason).toBe(
      openaiAdapter.fromCanonicalResponse(expected).choices[0].finish_reason,
    );
    expect(choice.message.content ?? "").toBe(expected.message.content);
    expect(
      (choice.message.tool_calls ?? []).map((tc) => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    ).toEqual(
      (expected.message.toolCalls ?? []).map((tc) => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    );
    if (expected.usage) {
      expect(final.usage).toMatchObject({
        prompt_tokens: expected.usage.inputTokens,
        completion_tokens: expected.usage.outputTokens,
        total_tokens: expected.usage.totalTokens,
      });
    }
  });

  it("openai encoder omits the usage chunk unless include_usage", () => {
    const fixture = fixtureFor("openai", "max_tokens");
    const without = encodeOpenai(fixture, {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    expect(without).not.toContain('"choices":[]');
    expect(without).not.toContain('"usage"');
    expect(without.trimEnd().endsWith("data: [DONE]")).toBe(true);

    const with_ = encodeOpenai(fixture, STREAMING_REQUEST);
    expect(with_).toContain('"choices":[]');
    const usage = fixture.expectedEvents.find((e) => e.type === "usage");
    expect(usage?.type).toBe("usage");
    if (usage?.type === "usage") {
      expect(with_).toContain(`"prompt_tokens":${usage.usage.inputTokens}`);
      expect(with_).toContain(
        `"completion_tokens":${usage.usage.outputTokens}`,
      );
    }
  });

  it.each(anthropicCases)("anthropic SDK parses encoded %s", async (name) => {
    const fixture = fixtureFor("anthropic", name);
    currentBody = encodeAnthropic(
      fixture.expectedEvents,
      ANTHROPIC_STREAMING_REQUEST,
    );

    const runner = anthropicClient().messages.stream(
      ANTHROPIC_STREAM_PARAMS,
    );
    for await (const _event of runner) {
      // consume the whole stream
    }
    const final = await runner.finalMessage();

    const expected = reassembleStream(fixture.expectedEvents);

    expect(final.model).toBe("m");
    const text = final.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    expect(text).toBe(expected.message.content);

    const toolUses = final.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    expect(toolUses.map((tu) => ({ name: tu.name, input: tu.input }))).toEqual(
      (expected.message.toolCalls ?? []).map((tc) => ({
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      })),
    );

    expect(final.stop_reason).toBe(
      mapToAnthropicStopReason(expected.finishReason),
    );
    if (expected.usage) {
      expect(final.usage).toMatchObject({
        input_tokens: expected.usage.inputTokens,
        output_tokens: expected.usage.outputTokens,
      });
    }
  });

  it("anthropic SDK raises the encoded error event", async () => {
    const fixture = fixtureFor("anthropic", "error");
    currentBody = encodeAnthropic(
      fixture.expectedEvents,
      ANTHROPIC_STREAMING_REQUEST,
    );

    const runner = anthropicClient().messages.stream(
      ANTHROPIC_STREAM_PARAMS,
    );
    const err = await (async () => {
      try {
        for await (const _event of runner) {
          // consume the whole stream
        }
        return undefined;
      } catch (e) {
        return e;
      }
    })();

    expect(err).toBeInstanceOf(Anthropic.APIError);
    expect((err as Anthropic.APIError).type).toBe("overloaded_error");
  });

  it("interleaved parallel calls", async () => {
    // Canonical index 1's deltas arrive before index 0's end — the encoder
    // buffers by canonical index and emits each tool_use block whole, so
    // both calls land in the SDK's final message with their own inputs.
    const events: CanonicalStreamEvent[] = [
      { type: "message_start", id: "msg_1", model: "m" },
      { type: "tool_call_start", index: 0, id: "toolu_a", name: "get_weather" },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsDelta: '{"city":',
      },
      { type: "tool_call_start", index: 1, id: "toolu_b", name: "get_time" },
      {
        type: "tool_call_delta",
        index: 1,
        argumentsDelta: '{"tz":"UTC"}',
      },
      { type: "tool_call_end", index: 1 },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsDelta: '"Paris"}',
      },
      { type: "tool_call_end", index: 0 },
      {
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      },
      { type: "message_end", finishReason: "tool_call" },
    ];
    currentBody = encodeAnthropic(events, ANTHROPIC_STREAMING_REQUEST);

    const runner = anthropicClient().messages.stream(
      ANTHROPIC_STREAM_PARAMS,
    );
    for await (const _event of runner) {
      // consume the whole stream
    }
    const final = await runner.finalMessage();

    const toolUses = final.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    expect(toolUses).toHaveLength(2);
    // The first call to finish gets the first content-block index.
    expect(toolUses[0]!.id).toBe("toolu_b");
    expect(toolUses[1]!.id).toBe("toolu_a");
    const byId = new Map(toolUses.map((tu) => [tu.id, tu]));
    expect(byId.get("toolu_a")?.name).toBe("get_weather");
    expect(byId.get("toolu_a")?.input).toEqual({ city: "Paris" });
    expect(byId.get("toolu_b")?.name).toBe("get_time");
    expect(byId.get("toolu_b")?.input).toEqual({ tz: "UTC" });
  });

  it("empty arguments become {}", () => {
    const events: CanonicalStreamEvent[] = [
      { type: "message_start", id: "msg_1", model: "m" },
      { type: "tool_call_start", index: 0, id: "toolu_a", name: "noop" },
      { type: "tool_call_end", index: 0 },
      { type: "message_end", finishReason: "tool_call" },
    ];
    const out = encodeAnthropic(events, ANTHROPIC_STREAMING_REQUEST);

    // content_block_start carries input:{} and the single
    // input_json_delta carries a valid empty object (spec §3.4).
    expect(out).toContain('"input":{}');
    expect(out).toContain('"partial_json":"{}"');
  });

  it("invalid arguments become the _invalid_arguments wrapper", () => {
    const events: CanonicalStreamEvent[] = [
      { type: "message_start", id: "msg_1", model: "m" },
      { type: "tool_call_start", index: 0, id: "toolu_a", name: "f" },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsDelta: "not-json",
      },
      { type: "tool_call_end", index: 0 },
      { type: "message_end", finishReason: "tool_call" },
    ];
    const out = encodeAnthropic(events, ANTHROPIC_STREAMING_REQUEST);

    expect(out).toContain("_invalid_arguments");
    expect(out).toContain("not-json");
  });

  it("text between tool_call_start and tool_call_end closes before the tool block", async () => {
    // A text_delta arriving while a tool call is still buffered opens a
    // text block; Anthropic never overlaps content blocks, so the text
    // block must stop before the tool_use block starts.
    const events: CanonicalStreamEvent[] = [
      { type: "message_start", id: "msg_1", model: "m" },
      { type: "tool_call_start", index: 0, id: "toolu_a", name: "get_weather" },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsDelta: '{"city":"Paris"}',
      },
      { type: "text_delta", text: "hi" },
      { type: "tool_call_end", index: 0 },
      { type: "message_end", finishReason: "tool_call" },
    ];
    currentBody = encodeAnthropic(events, ANTHROPIC_STREAMING_REQUEST);

    // On the wire every content_block_start is preceded by the
    // content_block_stop of any earlier block, and block indices are
    // contiguous from 0.
    const open = new Set<number>();
    const startIndices: number[] = [];
    for (const chunk of currentBody.split("\n\n")) {
      const data = chunk
        .split("\n")
        .find((l) => l.startsWith("data: "))
        ?.slice(6);
      if (data === undefined) continue;
      const event = JSON.parse(data) as { type: string; index?: number };
      if (event.type === "content_block_start") {
        expect(open.size).toBe(0);
        open.add(event.index!);
        startIndices.push(event.index!);
      } else if (event.type === "content_block_stop") {
        expect(open.has(event.index!)).toBe(true);
        open.delete(event.index!);
      }
    }
    expect(startIndices).toEqual([0, 1]);

    const runner = anthropicClient().messages.stream(
      ANTHROPIC_STREAM_PARAMS,
    );
    for await (const _event of runner) {
      // consume the whole stream
    }
    const final = await runner.finalMessage();

    expect(final.content.map((b) => b.type)).toEqual(["text", "tool_use"]);
    expect(final.content[0]).toMatchObject({ type: "text", text: "hi" });
    expect(final.content[1]).toMatchObject({
      type: "tool_use",
      id: "toolu_a",
      name: "get_weather",
      input: { city: "Paris" },
    });
  });

  it("anthropic encoder writes nothing after a terminal event", () => {
    const afterEnd = anthropicAdapter.createStreamEncoder({
      sourceRequest: ANTHROPIC_STREAMING_REQUEST,
      query: {},
      requestedModel: "m",
    });
    afterEnd.encode({ type: "message_start", id: "msg_1", model: "m" });
    afterEnd.encode({ type: "message_end", finishReason: "stop" });
    expect(afterEnd.encode({ type: "text_delta", text: "late" })).toBe("");
    expect(
      afterEnd.encode({ type: "message_end", finishReason: "stop" }),
    ).toBe("");
    expect(afterEnd.end()).toBe("");

    const afterError = anthropicAdapter.createStreamEncoder({
      sourceRequest: ANTHROPIC_STREAMING_REQUEST,
      query: {},
      requestedModel: "m",
    });
    afterError.encode({
      type: "error",
      error: { kind: "upstream", status: 502, message: "boom" },
    });
    expect(afterError.encode({ type: "text_delta", text: "late" })).toBe("");
    expect(
      afterError.encode({ type: "message_end", finishReason: "stop" }),
    ).toBe("");
  });

  it("anthropic SDK rejects on an error after message_start", async () => {
    const events: CanonicalStreamEvent[] = [
      { type: "message_start", id: "msg_1", model: "m" },
      { type: "text_delta", text: "hi" },
      {
        type: "error",
        error: { kind: "rate_limit", status: 429, message: "slow down" },
      },
    ];
    currentBody = encodeAnthropic(events, ANTHROPIC_STREAMING_REQUEST);
    const encodedType = (
      JSON.parse(
        currentBody
          .split("event: error\n")[1]!
          .split("\n")
          .find((l) => l.startsWith("data: "))!
          .slice(6),
      ) as { error: { type: string } }
    ).error.type;

    const runner = anthropicClient().messages.stream(
      ANTHROPIC_STREAM_PARAMS,
    );
    const err: unknown = await runner.finalMessage().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Anthropic.APIError);
    expect((err as Anthropic.APIError).type).toBe(encodedType);
  });
});
