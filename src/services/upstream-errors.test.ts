import { describe, it, expect } from "vitest";
import { toClientError } from "./upstream-errors";

/**
 * Upstream → client error mapping, one test per row of the spec §3.3
 * table. The target adapter parses the upstream body for its kind and
 * message; the mapping decides what the client sees.
 */

const OPENAI_404_BODY = {
  error: {
    message: "The model `gpt-9` does not exist",
    type: "invalid_request_error",
    param: null,
    code: "model_not_found",
  },
};

describe("toClientError — spec §3.3 mapping table", () => {
  it("upstream 400 → 400 invalid_request with upstream message", () => {
    const err = toClientError(
      "openai",
      400,
      { error: { message: "bad request", type: "invalid_request_error" } },
    );
    expect(err.kind).toBe("invalid_request");
    expect(err.status).toBe(400);
    expect(err.message).toBe("bad request");
  });

  it("upstream 422 → 400 invalid_request with upstream message", () => {
    const err = toClientError(
      "anthropic",
      422,
      { type: "error", error: { type: "invalid_request_error", message: "unprocessable" } },
    );
    expect(err.kind).toBe("invalid_request");
    expect(err.status).toBe(400);
    expect(err.message).toBe("unprocessable");
  });

  it("upstream 404 → 404 not_found with upstream message", () => {
    const err = toClientError("openai", 404, OPENAI_404_BODY);
    expect(err.kind).toBe("not_found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("The model `gpt-9` does not exist");
  });

  it("upstream 413 → 413 request_too_large", () => {
    const err = toClientError("ollama", 413, { error: "request too large" });
    expect(err.kind).toBe("request_too_large");
    expect(err.status).toBe(413);
    expect(err.message).toBe("request too large");
  });

  it("upstream 429 → 429 rate_limit", () => {
    const err = toClientError(
      "openai",
      429,
      { error: { message: "slow down", type: "rate_limit_error" } },
    );
    expect(err.kind).toBe("rate_limit");
    expect(err.status).toBe(429);
    expect(err.message).toBe("slow down");
  });

  it("Retry-After passes through on 429", () => {
    const err = toClientError(
      "openai",
      429,
      { error: { message: "slow down", type: "rate_limit_error" } },
      7,
    );
    expect(err.retryAfterSeconds).toBe(7);
  });

  it("upstream 401 → 502 upstream with credentials message", () => {
    const err = toClientError(
      "openai",
      401,
      {
        error: {
          message: "Incorrect API key provided: sk-test***abcd",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
    );
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
    expect(err.message).toBe(
      "Upstream openai rejected the proxy's credentials (401)",
    );
    // The upstream message echoes a key fragment — it must not leak.
    expect(err.message).not.toContain("sk-test");
  });

  it("upstream 403 → 502 upstream with credentials message", () => {
    const err = toClientError(
      "anthropic",
      403,
      { type: "error", error: { type: "permission_error", message: "forbidden" } },
    );
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
    expect(err.message).toBe(
      "Upstream anthropic rejected the proxy's credentials (403)",
    );
  });

  it("upstream 503 → 503 unavailable", () => {
    const err = toClientError(
      "openai",
      503,
      { error: { message: "overloaded", type: "service_unavailable_error" } },
    );
    expect(err.kind).toBe("unavailable");
    expect(err.status).toBe(503);
    expect(err.message).toBe("overloaded");
  });

  it("upstream 529 → 503 unavailable", () => {
    const err = toClientError(
      "anthropic",
      529,
      { type: "error", error: { type: "overloaded_error", message: "overloaded" } },
    );
    expect(err.kind).toBe("unavailable");
    expect(err.status).toBe(503);
    expect(err.message).toBe("overloaded");
  });

  it("upstream 500 → 502 upstream (not 500 internal)", () => {
    const err = toClientError("ollama", 500, { error: "upstream exploded" });
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
    expect(err.message).toBe("upstream exploded");
  });

  it("upstream 502 → 502 upstream", () => {
    const err = toClientError("ollama", 502, null);
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
    // Unrecognised body → adapter fallback message
    expect(err.message).toBe("Upstream ollama returned 502");
  });

  it("gemini 400 API_KEY_INVALID → 502 credentials message (kind, not status)", () => {
    // Gemini rejects a bad key with 400 + reason API_KEY_INVALID — the
    // adapter reads that as kind `authentication`, and the client must get
    // the credentials message, not a 400 that blames their request.
    const err = toClientError(
      "gemini",
      400,
      {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
            },
          ],
        },
      },
    );
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
    expect(err.message).toBe(
      "Upstream gemini rejected the proxy's credentials (400)",
    );
    expect(err.message).not.toContain("API key not valid");
  });
});
