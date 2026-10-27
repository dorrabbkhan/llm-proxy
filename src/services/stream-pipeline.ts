import type {
  CanonicalError,
  CanonicalStreamEvent,
  StreamDecoder,
  StreamEncoder,
} from "../types/canonical.types";
import { makeCanonicalError } from "../utils/canonical-error";

export interface StreamPipelineOptions {
  /** The upstream response body — bytes as they arrive off the socket */
  upstream: ReadableStream<Uint8Array>;
  /** Target provider: upstream bytes → canonical events */
  decoder: StreamDecoder;
  /** Source provider: canonical events → client wire bytes */
  encoder: StreamEncoder;
  /** Longest allowed gap between upstream chunks (UPSTREAM_STREAM_IDLE_MS) */
  idleMs: number;
  /** Client disconnect — stops the pipe and cancels the upstream read */
  signal: AbortSignal;
}

/**
 * upstream bytes → decoder → canonical events → encoder → client bytes
 * (spec §3.2). Provider-agnostic; the adapters own all dialect knowledge.
 *
 * Termination rules: an upstream read error, undecodable data or an idle
 * gap longer than `idleMs` ends the stream with the source dialect's
 * in-stream error form (kind `timeout` for idle, `upstream` otherwise) —
 * the client never sees a truncated message followed by silence. Aborting
 * `signal` cancels the upstream read and ends the pipe quietly.
 */
export async function* runStreamPipeline(
  opts: StreamPipelineOptions,
): AsyncIterable<string> {
  const { upstream, decoder, encoder, idleMs, signal } = opts;
  const reader = upstream.getReader();

  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });

  /** Terminal events never produce empty output — the encoder writes the
   * provider's in-stream error form, then the stream ends. */
  function* fail(kind: CanonicalError["kind"], message: string) {
    yield encoder.encode({
      type: "error",
      error: makeCanonicalError(kind, message),
    });
    const tail = encoder.end();
    if (tail !== "") yield tail;
  }

  function* encodeAll(events: CanonicalStreamEvent[]) {
    for (const event of events) {
      const encoded = encoder.encode(event);
      if (encoded !== "") yield encoded;
    }
  }

  try {
    for (;;) {
      if (signal.aborted) {
        cancel();
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let chunk: ReadableStreamReadResult<Uint8Array> | "idle";
      try {
        chunk = await Promise.race([
          reader.read(),
          new Promise<"idle">((resolve) => {
            timer = setTimeout(() => resolve("idle"), idleMs);
          }),
        ]);
      } catch {
        clearTimeout(timer);
        cancel();
        yield* fail("upstream", "Upstream stream read failed");
        return;
      }
      clearTimeout(timer);

      if (signal.aborted) {
        cancel();
        return;
      }

      if (chunk === "idle") {
        cancel();
        yield* fail(
          "timeout",
          `Upstream stream idle for over ${idleMs}ms`,
        );
        return;
      }

      let events: CanonicalStreamEvent[];
      if (chunk.done) {
        try {
          events = decoder.end();
        } catch {
          yield* fail("upstream", "Upstream sent a malformed stream");
          return;
        }
        yield* encodeAll(events);
        const tail = encoder.end();
        if (tail !== "") yield tail;
        return;
      }

      try {
        events = decoder.feed(chunk.value);
      } catch {
        cancel();
        yield* fail("upstream", "Upstream sent undecodable stream data");
        return;
      }
      yield* encodeAll(events);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}
