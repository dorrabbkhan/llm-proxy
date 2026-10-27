import { describe, it, expect } from "vitest";
import {
  createUtf8Decoder,
  createSseParser,
  formatSse,
  createLineSplitter,
} from "./sse";

describe("createUtf8Decoder", () => {
  it("utf8 split mid-character", () => {
    const decode = createUtf8Decoder();
    const bytes = new TextEncoder().encode("é😀");
    let out = "";
    for (const b of bytes) {
      out += decode(new Uint8Array([b]));
    }
    expect(out).toBe("é😀");
  });
});

describe("createSseParser", () => {
  it("sse every split point", () => {
    const text =
      'event: a\ndata: {"x":1}\n\ndata: two\ndata: lines\r\n\r\n';
    const expected = [
      { event: "a", data: '{"x":1}' },
      { data: "two\nlines" },
    ];
    for (let i = 0; i <= text.length; i++) {
      const parser = createSseParser();
      const events = [
        ...parser.feed(text.slice(0, i)),
        ...parser.feed(text.slice(i)),
        ...parser.end(),
      ];
      expect(events).toEqual(expected);
    }
  });

  it("sse ignores comments", () => {
    const parser = createSseParser();
    const events = [
      ...parser.feed(": keep-alive\n\n"),
      ...parser.feed("data: x\n: mid-event comment\ndata: y\n\n"),
    ];
    expect(events).toEqual([{ data: "x\ny" }]);
  });

  it("formatSse round-trips through the parser", () => {
    const parser = createSseParser();
    expect(parser.feed(formatSse('{"x":1}', "message"))).toEqual([
      { event: "message", data: '{"x":1}' },
    ]);
    expect(parser.feed(formatSse("[DONE]"))).toEqual([{ data: "[DONE]" }]);
  });
});

describe("createLineSplitter", () => {
  it("line splitter keeps a trailing partial line until end()", () => {
    const split = createLineSplitter();
    expect(split.feed("one\ntwo\nth")).toEqual(["one", "two"]);
    expect(split.feed("ree\n")).toEqual(["three"]);
    expect(split.feed("four")).toEqual([]);
    expect(split.end()).toEqual(["four"]);
  });

  it("drops empty lines", () => {
    const split = createLineSplitter();
    expect(split.feed("a\n\n\nb\n")).toEqual(["a", "b"]);
  });
});
