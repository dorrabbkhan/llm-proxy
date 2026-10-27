import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adapters, type Provider } from "../../src/transformers";
import { sequentialIds } from "../../src/utils/ids";
import type { CanonicalStreamEvent } from "../../src/types/canonical.types";

/**
 * Stream decoder contract (spec §3.3, §4.1): each provider's decoder must
 * turn the recorded wire bytes into exactly the fixture's expectedEvents —
 * identically however the bytes are split into network chunks, and with an
 * error event (never silence) when the stream ends early.
 *
 * Rows are generated per provider and case; a provider joins when its
 * decoder lands (Tasks 4–7).
 */
const STREAMS_DIR = join(__dirname, "..", "fixtures", "streams");

const WIRE_EXT: Record<Provider, string> = {
  openai: "sse",
  anthropic: "sse",
  gemini: "sse",
  ollama: "ndjson",
};

// Providers whose createStreamDecoder is implemented.
const DECODED_PROVIDERS: Provider[] = ["openai", "anthropic"];

const EVERY_SPLIT_MAX_BYTES = 4 * 1024;
const SAMPLED_SPLIT_POINTS = 150;

interface StreamFixture {
  source: string;
  date: string;
  model: string;
  expectedEvents: CanonicalStreamEvent[];
}

const cases: { provider: Provider; name: string }[] = [];
for (const provider of DECODED_PROVIDERS) {
  const dir = join(STREAMS_DIR, provider);
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json") && !file.endsWith(".nonstreaming.json")) {
      cases.push({ provider, name: file.slice(0, -".json".length) });
    }
  }
}

function fixtureFor(provider: Provider, name: string): StreamFixture {
  return JSON.parse(
    readFileSync(join(STREAMS_DIR, provider, `${name}.json`), "utf8"),
  ) as StreamFixture;
}

function wireBytes(provider: Provider, name: string): Uint8Array {
  return readFileSync(
    join(STREAMS_DIR, provider, `${name}.${WIRE_EXT[provider]}`),
  );
}

function decode(
  provider: Provider,
  model: string,
  chunks: Uint8Array[],
): CanonicalStreamEvent[] {
  const decoder = adapters[provider].createStreamDecoder(
    model,
    sequentialIds(),
  );
  const events: CanonicalStreamEvent[] = [];
  for (const chunk of chunks) events.push(...decoder.feed(chunk));
  events.push(...decoder.end());
  return events;
}

describe("stream decoders", () => {
  it.each(cases)(
    "$provider/$name decodes to the fixture's events",
    ({ provider, name }) => {
      const fixture = fixtureFor(provider, name);
      const events = decode(provider, fixture.model, [
        wireBytes(provider, name),
      ]);
      expect(events).toEqual(fixture.expectedEvents);
    },
  );

  it.each(cases)(
    "$provider/$name decodes identically at every split point",
    ({ provider, name }) => {
      const fixture = fixtureFor(provider, name);
      const bytes = wireBytes(provider, name);

      // Byte splits may land inside a multi-byte UTF-8 character or an SSE
      // frame — the event sequence must not depend on where they fall.
      // Fixtures over 4 KB are sampled deterministically instead.
      const splits: number[] = [];
      if (bytes.length <= EVERY_SPLIT_MAX_BYTES) {
        for (let i = 1; i < bytes.length; i++) splits.push(i);
      } else {
        const stride = Math.floor(bytes.length / SAMPLED_SPLIT_POINTS);
        for (let i = stride; i < bytes.length; i += stride) splits.push(i);
      }

      for (const split of splits) {
        const events = decode(provider, fixture.model, [
          bytes.subarray(0, split),
          bytes.subarray(split),
        ]);
        expect(events, `split at byte ${split}`).toEqual(
          fixture.expectedEvents,
        );
      }
    },
  );

  it("openai truncated stream ends with an error event", () => {
    // Drop `data: [DONE]` and the last chunk — the decoder must report an
    // in-stream error, not a silent half-message (spec §3.2).
    const text = readFileSync(
      join(STREAMS_DIR, "openai", "text.sse"),
      "utf8",
    );
    const lines = text.split("\n").filter((l) => l !== "data: [DONE]");
    const lastData = lines.map((l, i) => (l.startsWith("data:") ? i : -1));
    const drop = Math.max(...lastData);
    const truncated = lines.filter((_, i) => i !== drop).join("\n");

    const events = decode("openai", "gpt-6-astra", [
      new TextEncoder().encode(truncated),
    ]);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("anthropic truncated stream ends with an error event", () => {
    // Drop `event: message_stop` — the socket just closes mid-stream and
    // the decoder must report an in-stream error, not a silent
    // half-message (spec §3.2, docs.claude.com "Streaming Messages":
    // message_stop is the terminal event).
    const text = readFileSync(
      join(STREAMS_DIR, "anthropic", "text.sse"),
      "utf8",
    );
    const truncated = text
      .split("\n")
      .filter((l) => !l.includes("message_stop"))
      .join("\n");

    const events = decode("anthropic", "claude-opus-5-5", [
      new TextEncoder().encode(truncated),
    ]);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("anthropic decoder drops thinking deltas", () => {
    // Thinking blocks and their thinking_delta/signature_delta events
    // produce no canonical events (docs.claude.com "Streaming with
    // extended thinking" — built inline; no fixture carries them).
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_t1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"secret reasoning"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
      "",
    ].join("\n\n");

    const events = decode("anthropic", "claude-opus-5-5", [
      new TextEncoder().encode(sse),
    ]);
    expect(events).toEqual([
      {
        type: "message_start",
        id: "msg_t1",
        model: "claude-opus-5-5",
      },
      { type: "text_delta", text: "Hi" },
      {
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      { type: "message_end", finishReason: "stop" },
    ]);
  });
});
