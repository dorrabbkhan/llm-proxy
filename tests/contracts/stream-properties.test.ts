import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adapters, type Provider } from "../../src/transformers";
import { reassembleStream } from "../../src/utils/stream-reassemble";
import { parseToolArguments } from "../../src/utils/tool-args";
import { sequentialIds } from "../../src/utils/ids";
import type {
  CanonicalResponse,
  CanonicalStreamEvent,
} from "../../src/types/canonical.types";

/**
 * Stream round-trip properties (spec §4.4):
 *
 * (a) "<provider> decode(encode(events)) equals events" — 200 random
 *     valid event sequences per adapter from a seeded mulberry32
 *     generator (the case seed is printed on failure). Wire formats
 *     differ in what they can carry, so equality is asserted on the
 *     REASSEMBLED stream rather than event-by-event:
 *       - Anthropic buffers each call's arguments and writes one
 *         normalized JSON delta at tool_call_end — the plan's
 *         documented exception;
 *       - Ollama and Gemini likewise buffer per canonical index and
 *         emit each call whole at tool_call_end;
 *       - OpenAI has no wire position for tool_call_end (its decoder
 *         closes calls at the finish chunk) and emits usage at [DONE]
 *         regardless of the event's position;
 *       - Ollama has no message id — its decoder generates one
 *         ("call_0" under sequentialIds).
 *     The reassembled {message, finishReason, usage} must be identical;
 *     tool arguments compare in wire form (the raw JSON string for
 *     OpenAI, the parseToolArguments-normalized object for the others —
 *     the same rule the encoders apply, including the
 *     `_invalid_arguments` wrapper).
 *
 * (b) "<provider>/<case> stream reassembles to the non-streaming twin"
 *     — for every fixture carrying a `nonStreaming` body, decoding the
 *     wire bytes and reassembling equals `toCanonicalResponse` of the
 *     twin on message, finishReason and usage.
 */
const STREAMS_DIR = join(__dirname, "..", "fixtures", "streams");

const WIRE_EXT: Record<Provider, string> = {
  openai: "sse",
  anthropic: "sse",
  gemini: "sse",
  ollama: "ndjson",
};

const SEED = 0x5eed;
const CASES_PER_PROVIDER = 200;
const PROVIDERS: Provider[] = ["openai", "anthropic", "gemini", "ollama"];

/** Seeded generator — small fast PRNG, deterministic per run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOURCE_REQUESTS: Record<
  Provider,
  { sourceRequest: unknown; query: Record<string, string> }
> = {
  openai: {
    sourceRequest: {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
    },
    query: {},
  },
  anthropic: {
    sourceRequest: {
      model: "m",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    },
    query: {},
  },
  gemini: {
    sourceRequest: {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    },
    query: { alt: "sse" },
  },
  ollama: {
    sourceRequest: {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    },
    query: {},
  },
};

const TEXT_POOL = [
  "Hi",
  " there",
  "é",
  "😀",
  ".\n\n",
  "Paris",
  " 15",
  "°C",
  "…",
];
const NAME_POOL = ["get_weather", "sum", "lookup_user"];
const ARGS_POOL = [
  '{"location":"Paris"}',
  '{"a":2,"b":3}',
  "{}",
  '{"city":"Berlin","ok":true,"tags":["x","y"]}',
  "not json",
  "[1,2]",
];

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)] as T;
}

/** Split a string into 1–3 non-empty fragments at random points. */
function splitIntoFragments(rand: () => number, s: string): string[] {
  if (s === "") return [""];
  const count = Math.min(s.length, 1 + Math.floor(rand() * 3));
  const cuts = new Set<number>();
  while (cuts.size < count - 1) {
    cuts.add(1 + Math.floor(rand() * (s.length - 1)));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const fragments: string[] = [];
  let prev = 0;
  for (const c of sorted) {
    fragments.push(s.slice(prev, c));
    prev = c;
  }
  fragments.push(s.slice(prev));
  return fragments;
}

/**
 * One random valid canonical event sequence (spec §3.1): message_start,
 * then any mix of text deltas and 0–3 tool calls whose argument deltas
 * may interleave, optional usage, then message_end. Tool-call ends stay
 * in index order — every adapter emits wire calls in tool_call_end
 * order, so an out-of-order end would renumber the decoded calls
 * (a wire limitation, not a canonical one). A call's own deltas always
 * precede its end.
 */
function generateEvents(
  rand: () => number,
  provider: Provider,
  n: number,
): CanonicalStreamEvent[] {
  const events: CanonicalStreamEvent[] = [
    { type: "message_start", id: `msg_${provider}_${n}`, model: "m" },
  ];

  const calls = Array.from(
    { length: Math.floor(rand() * 4) },
    (_, i) => ({
      id: `call_${provider}_${n}_${i}`,
      name: pick(rand, NAME_POOL),
      fragments: splitIntoFragments(rand, pick(rand, ARGS_POOL)),
    }),
  );
  const texts = Array.from({ length: Math.floor(rand() * 5) }, () =>
    pick(rand, TEXT_POOL),
  );

  const remaining = calls.map((c) => c.fragments.length);
  let started = 0;
  let ended = 0;
  let t = 0;
  for (;;) {
    const options: string[] = [];
    if (t < texts.length) options.push("text", "text");
    if (started < calls.length) options.push("start");
    // Any open call may emit its next fragment — deltas interleave.
    const ready = calls
      .map((_, i) => i)
      .filter((i) => i >= ended && i < started && remaining[i] > 0);
    if (ready.length > 0) options.push("delta");
    if (ended < started && remaining[ended] === 0) options.push("end");
    if (options.length === 0) break;
    switch (pick(rand, options)) {
      case "text":
        events.push({ type: "text_delta", text: texts[t++] });
        break;
      case "start": {
        const call = calls[started];
        events.push({
          type: "tool_call_start",
          index: started,
          id: call.id,
          name: call.name,
        });
        started++;
        break;
      }
      case "delta": {
        const i = pick(rand, ready);
        events.push({
          type: "tool_call_delta",
          index: i,
          argumentsDelta: calls[i].fragments[
            calls[i].fragments.length - remaining[i]
          ],
        });
        remaining[i]--;
        break;
      }
      default:
        events.push({ type: "tool_call_end", index: ended });
        ended++;
    }
  }

  // Usage is optional; anthropic/ollama wire streams always carry
  // counts (their decoders emit a usage event even when the encoder
  // saw none), so the generated sequence always includes one there.
  const withUsage =
    provider === "anthropic" || provider === "ollama"
      ? true
      : rand() < 0.75;
  if (withUsage) {
    const inputTokens = Math.floor(rand() * 2000);
    const outputTokens = Math.floor(rand() * 500);
    // Anthropic/Ollama recompute the total from the parts — keep the
    // generated triple internally consistent.
    events.push({
      type: "usage",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    });
  }
  events.push({
    type: "message_end",
    finishReason:
      calls.length > 0 ? "tool_call" : rand() < 0.8 ? "stop" : "length",
  });
  return events;
}

function encode(provider: Provider, events: CanonicalStreamEvent[]): string {
  const { sourceRequest, query } = SOURCE_REQUESTS[provider];
  const encoder = adapters[provider].createStreamEncoder({
    sourceRequest,
    query,
    requestedModel: "m",
  });
  let out = "";
  for (const event of events) out += encoder.encode(event);
  return out + encoder.end();
}

/** Decode the whole wire reply, split into up to three byte chunks. */
function decode(
  provider: Provider,
  wire: string,
  rand: () => number,
): CanonicalStreamEvent[] {
  const decoder = adapters[provider].createStreamDecoder(
    "m",
    sequentialIds(),
  );
  const bytes = new TextEncoder().encode(wire);
  const events: CanonicalStreamEvent[] = [];
  const cuts = [
    ...new Set([
      0,
      bytes.length,
      Math.floor(rand() * (bytes.length + 1)),
      Math.floor(rand() * (bytes.length + 1)),
    ]),
  ].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    events.push(...decoder.feed(bytes.subarray(cuts[i], cuts[i + 1])));
  }
  events.push(...decoder.end());
  return events;
}

/** The reply shape the round-trip must preserve (see file header). */
function normalized(response: CanonicalResponse, provider: Provider) {
  return {
    message: {
      role: response.message.role,
      content: response.message.content,
      toolCalls: (response.message.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments:
          provider === "openai"
            ? tc.function.arguments
            : JSON.stringify(
                parseToolArguments(tc.function.arguments).args,
              ),
      })),
    },
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

const cases = PROVIDERS.flatMap((provider) =>
  Array.from({ length: CASES_PER_PROVIDER }, (_, i) => ({
    provider,
    i,
    seed: SEED + PROVIDERS.indexOf(provider) * CASES_PER_PROVIDER + i,
  })),
);

describe("stream round-trip properties", () => {
  it.each(cases)(
    "$provider decode(encode(events)) equals events (case $i)",
    ({ provider, i, seed }) => {
      const rand = mulberry32(seed);
      const events = generateEvents(rand, provider, i);
      const wire = encode(provider, events);
      const decodedEvents = decode(provider, wire, rand);

      const first = decodedEvents[0];
      expect(first?.type, `seed ${seed}: first event`).toBe(
        "message_start",
      );
      if (first?.type === "message_start") {
        expect(first.model, `seed ${seed}: requested model`).toBe("m");
        // Ollama has no message id on the wire — its decoder generates
        // one (sequentialIds → "call_0"); the others echo the event id.
        expect(first.id, `seed ${seed}: message id`).toBe(
          provider === "ollama"
            ? "call_0"
            : (events[0] as { id: string }).id,
        );
      }

      const expected = reassembleStream(events);
      const actual = reassembleStream(decodedEvents);
      expect(
        normalized(actual, provider),
        `seed ${seed}: decoded stream must reassemble to the same ` +
          `message/finishReason/usage`,
      ).toEqual(normalized(expected, provider));
    },
  );
});

// ===== (b) recorded streams vs their non-streaming twins =====

interface StreamFixture {
  model: string;
  expectedEvents: CanonicalStreamEvent[];
  nonStreaming?: unknown;
}

const twinCases: { provider: Provider; name: string; fixture: StreamFixture }[] =
  [];
for (const provider of PROVIDERS) {
  const dir = join(STREAMS_DIR, provider);
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json") && !file.endsWith(".nonstreaming.json")) {
      const fixture = JSON.parse(
        readFileSync(join(dir, file), "utf8"),
      ) as StreamFixture;
      if (fixture.nonStreaming != null) {
        twinCases.push({
          provider,
          name: file.slice(0, -".json".length),
          fixture,
        });
      }
    }
  }
}

describe("stream vs non-streaming twin", () => {
  it.each(twinCases)(
    "$provider/$name stream reassembles to the non-streaming twin",
    ({ provider, name, fixture }) => {
      const bytes = readFileSync(
        join(STREAMS_DIR, provider, `${name}.${WIRE_EXT[provider]}`),
      );
      const decoder = adapters[provider].createStreamDecoder(
        fixture.model,
        sequentialIds(),
      );
      const events = [...decoder.feed(bytes), ...decoder.end()];
      const reassembled = reassembleStream(events);
      const twin = adapters[provider].toCanonicalResponse(
        fixture.nonStreaming,
        fixture.model,
        sequentialIds(),
      );
      expect({
        message: reassembled.message,
        finishReason: reassembled.finishReason,
        usage: reassembled.usage,
      }).toEqual({
        message: twin.message,
        finishReason: twin.finishReason,
        usage: twin.usage,
      });
    },
  );
});
