import { describe, it, expect } from "vitest";
import { detectSource } from "./detect-source";

/**
 * Path-based client-format detection (spec §3.2): every provider's
 * routes answer on one port. `GET /v1/models` is the one ambiguous
 * path — Anthropic SDKs and Claude Code always send `anthropic-version`
 * (@anthropic-ai/sdk client.js:842, unconditional default header).
 */

const noHeaders = {};

describe("detectSource", () => {
  it("POST /v1/chat/completions → openai", () => {
    expect(detectSource("POST", "/v1/chat/completions", noHeaders)).toBe(
      "openai",
    );
  });

  it("POST /v1/messages → anthropic", () => {
    expect(detectSource("POST", "/v1/messages", noHeaders)).toBe("anthropic");
  });

  it("POST /v1/messages/count_tokens → anthropic", () => {
    expect(detectSource("POST", "/v1/messages/count_tokens", noHeaders)).toBe(
      "anthropic",
    );
  });

  it("GET /v1beta/models → gemini", () => {
    expect(detectSource("GET", "/v1beta/models", noHeaders)).toBe("gemini");
  });

  it("POST /v1beta/models/<m>:generateContent → gemini", () => {
    expect(
      detectSource("POST", "/v1beta/models/llama3:generateContent", noHeaders),
    ).toBe("gemini");
  });

  it("POST /api/chat → ollama", () => {
    expect(detectSource("POST", "/api/chat", noHeaders)).toBe("ollama");
  });

  it("GET /api/tags → ollama", () => {
    expect(detectSource("GET", "/api/tags", noHeaders)).toBe("ollama");
  });

  it("GET /v1/models with anthropic-version → anthropic", () => {
    expect(
      detectSource("GET", "/v1/models", {
        "anthropic-version": "2023-06-01",
      }),
    ).toBe("anthropic");
  });

  it("GET /v1/models without anthropic-version → openai", () => {
    expect(detectSource("GET", "/v1/models", noHeaders)).toBe("openai");
  });

  // Carried over from resolve-source.test.ts: detection is pure
  // path+method+headers — no config to be broken, so the "never throws"
  // case is dropped.
  it("GET /health → undefined", () => {
    expect(detectSource("GET", "/health", noHeaders)).toBeUndefined();
  });

  it("unknown path → undefined", () => {
    expect(detectSource("POST", "/v1/unknown", noHeaders)).toBeUndefined();
  });

  it("GET /v1/chat/completions → undefined (method mismatch)", () => {
    expect(
      detectSource("GET", "/v1/chat/completions", noHeaders),
    ).toBeUndefined();
  });
});
