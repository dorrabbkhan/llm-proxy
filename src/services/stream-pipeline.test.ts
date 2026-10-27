import { describe, it, expect, vi } from "vitest";
import type {
  CanonicalError,
  CanonicalStreamEvent,
  StreamDecoder,
  StreamEncoder,
} from "../types/canonical.types";
import { makeCanonicalError } from "../utils/canonical-error";
import { runStreamPipeline } from "./stream-pipeline";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Tag-encoder: each event becomes `<type>` so output order is visible. */
function tagEncoder(): StreamEncoder {
  return {
    contentType: "text/event-stream",
    encode: (event) => `<${event.type}>`,
    end: () => "<end>",
  };
}

async function collect(
  upstream: ReadableStream<Uint8Array>,
  decoder: StreamDecoder,
  encoder: StreamEncoder,
): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of runStreamPipeline({
    upstream,
    decoder,
    encoder,
    idleMs: 1_000,
    signal: new AbortController().signal,
  })) {
    out.push(chunk);
  }
  return out;
}

describe("runStreamPipeline terminal events", () => {
  it("encodes nothing after message_end, even mid-stream", async () => {
    const cancelled = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes("first"));
        controller.enqueue(bytes("second"));
      },
      cancel: cancelled,
    });

    const batches: CanonicalStreamEvent[][] = [
      [
        { type: "message_start", id: "x", model: "m" },
        { type: "message_end", finishReason: "stop" },
      ],
      [{ type: "text_delta", text: "LATE" }],
    ];
    const feed = vi.fn(() => batches.shift() ?? []);
    const decoder: StreamDecoder = { feed, end: () => [] };

    const out = await collect(upstream, decoder, tagEncoder());

    expect(out).toEqual(["<message_start>", "<message_end>", "<end>"]);
    expect(feed).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalled();
  });

  it("encodes nothing after a decoder error event", async () => {
    const cancelled = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes("first"));
        controller.enqueue(bytes("second"));
      },
      cancel: cancelled,
    });

    const error: CanonicalError = makeCanonicalError("upstream", "bad");
    const batches: CanonicalStreamEvent[][] = [
      [{ type: "message_start", id: "x", model: "m" }],
      [{ type: "error", error }],
      [{ type: "text_delta", text: "LATE" }],
    ];
    const feed = vi.fn(() => batches.shift() ?? []);
    const decoder: StreamDecoder = { feed, end: () => [] };

    const out = await collect(upstream, decoder, tagEncoder());

    expect(out).toEqual(["<message_start>", "<error>", "<end>"]);
    expect(feed).toHaveBeenCalledTimes(2);
    expect(cancelled).toHaveBeenCalled();
  });
});
