import { describe, it, expect } from "vitest";
import {
  PROVIDER_ROUTES,
  openaiAdapter,
  geminiAdapter,
  anthropicAdapter,
} from "./index";
import type { CanonicalRequest } from "../../types/canonical.types";

const CANONICAL_NO_STREAM: CanonicalRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "Hello" }],
};

describe("PROVIDER_ROUTES", () => {
  const geminiChatRoute = PROVIDER_ROUTES.gemini.find(
    (r) => r.kind === "chat",
  )!;

  it("modelFromPath decodes and keeps slashes", () => {
    expect(
      geminiChatRoute.modelFromPath?.(
        "/v1beta/models/gemini-2.0-flash:generateContent",
      ),
    ).toBe("gemini-2.0-flash");
    expect(
      geminiChatRoute.modelFromPath?.(
        "/v1beta/models/tunedModels/my-model:generateContent",
      ),
    ).toBe("tunedModels/my-model");
    expect(
      geminiChatRoute.modelFromPath?.(
        "/v1beta/models/gemini-2.0-flash%3AgenerateContent",
      ),
    ).toBe("gemini-2.0-flash");
    expect(
      geminiChatRoute.modelFromPath?.("/v1beta/models"),
    ).toBeUndefined();
  });

  it("isStreamPath only matches :streamGenerateContent", () => {
    expect(
      geminiChatRoute.isStreamPath?.(
        "/v1beta/models/gemini-2.0-flash:streamGenerateContent",
      ),
    ).toBe(true);
    expect(
      geminiChatRoute.isStreamPath?.(
        "/v1beta/models/gemini-2.0-flash%3AstreamGenerateContent",
      ),
    ).toBe(true);
    expect(
      geminiChatRoute.isStreamPath?.(
        "/v1beta/models/gemini-2.0-flash:generateContent",
      ),
    ).toBe(false);
    expect(
      geminiChatRoute.isStreamPath?.("/v1beta/models"),
    ).toBe(false);
  });

  it("isSupportedPath refuses non-chat methods", () => {
    expect(
      geminiChatRoute.isSupportedPath?.(
        "/v1beta/models/gemini-2.0-flash:generateContent",
      ),
    ).toBe(true);
    expect(
      geminiChatRoute.isSupportedPath?.(
        "/v1beta/models/gemini-2.0-flash:streamGenerateContent",
      ),
    ).toBe(true);
    expect(
      geminiChatRoute.isSupportedPath?.(
        "/v1beta/models/tunedModels/my-model:generateContent",
      ),
    ).toBe(true);
    expect(
      geminiChatRoute.isSupportedPath?.(
        "/v1beta/models/gemini-2.0-flash:countTokens",
      ),
    ).toBe(false);
    expect(
      geminiChatRoute.isSupportedPath?.(
        "/v1beta/models/gemini-2.0-flash%3AcountTokens",
      ),
    ).toBe(false);
    // no "<m>:<method>" pair → not claimed, falls through as before
    expect(
      geminiChatRoute.isSupportedPath?.("/v1beta/models"),
    ).toBe(true);
  });
});

describe("adapters: request without stream", () => {
  it("openai request without stream sends no streaming flag", () => {
    const body = openaiAdapter.fromCanonicalRequest(
      CANONICAL_NO_STREAM,
    ) as unknown as Record<string, unknown>;
    expect(body.stream === undefined || body.stream === false).toBe(true);
  });

  it("anthropic request without stream sends no streaming flag", () => {
    const body = anthropicAdapter.fromCanonicalRequest(
      CANONICAL_NO_STREAM,
    ) as unknown as Record<string, unknown>;
    expect(body.stream === undefined || body.stream === false).toBe(true);
  });

  it("gemini request without stream sends no streaming flag", () => {
    const body = geminiAdapter.fromCanonicalRequest(
      CANONICAL_NO_STREAM,
    ) as unknown as Record<string, unknown>;
    expect("stream" in body).toBe(false);
  });
});
