/**
 * Stream wire utilities (spec §3.1, §3.3): incremental UTF-8 decoding,
 * Server-Sent Events parsing/formatting and NDJSON line splitting.
 * All are pure, stateful factories — one instance per request.
 */

/**
 * Incremental UTF-8 decoder: byte chunks may split a multi-byte character
 * anywhere; strings pass through. Feeding an empty Uint8Array flushes any
 * bytes left over at end-of-stream.
 */
export function createUtf8Decoder(): (chunk: Uint8Array | string) => string {
  const decoder = new TextDecoder("utf-8");
  return (chunk) =>
    typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
}

/**
 * Take the complete lines out of `buffer`, keyed on "\n" (a trailing "\r"
 * is stripped, so "\r\n" split across chunks is handled). With `flush`,
 * a final unterminated line is emitted too.
 */
function takeLines(buffer: string, flush: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === "\n") {
      let line = buffer.slice(start, i);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      start = i + 1;
    }
  }
  let rest = buffer.slice(start);
  if (flush && rest !== "") {
    if (rest.endsWith("\r")) rest = rest.slice(0, -1);
    if (rest !== "") lines.push(rest);
    rest = "";
  }
  return { lines, rest };
}

/** One completed SSE event: `data` lines joined by "\n", optional `event`. */
export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Incremental SSE parser. Handles "\n" and "\r\n" endings, multi-line
 * `data:` fields, and comment lines starting with ":"; `id:`, `retry:`
 * and unknown fields are ignored. Events are dispatched on blank lines;
 * one still buffered at end() is dispatched there. An event with no
 * `data:` field is dropped.
 */
export function createSseParser(): {
  feed(text: string): SseEvent[];
  end(): SseEvent[];
} {
  let buffer = "";
  let dataLines: string[] = [];
  let hasData = false;
  let eventType: string | undefined;

  function dispatch(out: SseEvent[]): void {
    if (hasData) {
      out.push({
        ...(eventType !== undefined && { event: eventType }),
        data: dataLines.join("\n"),
      });
    }
    dataLines = [];
    hasData = false;
    eventType = undefined;
  }

  function processLines(lines: string[], flush: boolean): SseEvent[] {
    const out: SseEvent[] = [];
    for (const line of lines) {
      if (line === "") {
        dispatch(out);
        continue;
      }
      if (line.startsWith(":")) continue; // comment
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") {
        dataLines.push(value);
        hasData = true;
      } else if (field === "event") {
        eventType = value;
      }
    }
    if (flush) dispatch(out);
    return out;
  }

  return {
    feed(text) {
      buffer += text;
      const taken = takeLines(buffer, false);
      buffer = taken.rest;
      return processLines(taken.lines, false);
    },
    end() {
      const taken = takeLines(buffer, true);
      buffer = taken.rest;
      return processLines(taken.lines, true);
    },
  };
}

/** Render one SSE event: optional `event:` line, one `data:` per line. */
export function formatSse(data: string, event?: string): string {
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `${event !== undefined ? `event: ${event}\n` : ""}${dataLines}\n\n`;
}

/**
 * Incremental splitter for line-delimited bodies (Ollama NDJSON).
 * Returns non-empty lines only; a trailing partial line is held until
 * it completes or end() flushes it.
 */
export function createLineSplitter(): {
  feed(text: string): string[];
  end(): string[];
} {
  let buffer = "";
  function take(flush: boolean): string[] {
    const taken = takeLines(buffer, flush);
    buffer = taken.rest;
    return taken.lines.filter((line) => line !== "");
  }
  return {
    feed(text) {
      buffer += text;
      return take(false);
    },
    end() {
      return take(true);
    },
  };
}
