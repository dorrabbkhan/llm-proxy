import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openaiAdapter } from "../../src/transformers/adapters";
import { reassembleStream } from "../../src/utils/stream-reassemble";
import type { CanonicalStreamEvent } from "../../src/types/canonical.types";
import type { ChatCompletionRequest } from "../../src/types/openai.types";

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
});
