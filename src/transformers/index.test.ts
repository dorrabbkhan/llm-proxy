import { describe, it, expect } from "vitest";
import {
  adapters,
  getTransformers,
  transformRequest,
  transformResponse,
  toCanonical,
  fromCanonical,
} from "./index";
import { ConfigurationError } from "../utils/errors";
import type { ChatCompletionRequest } from "../types/openai.types";

describe("adapters", () => {
  it("should have all provider adapters", () => {
    expect(adapters.openai).toBeDefined();
    expect(adapters.gemini).toBeDefined();
    expect(adapters.ollama).toBeDefined();
    expect(adapters.anthropic).toBeDefined();
  });

  it("should have all required methods on each adapter", () => {
    for (const [name, adapter] of Object.entries(adapters)) {
      expect(typeof adapter.toCanonicalRequest).toBe("function");
      expect(typeof adapter.fromCanonicalRequest).toBe("function");
      expect(typeof adapter.toCanonicalResponse).toBe("function");
      expect(typeof adapter.fromCanonicalResponse).toBe("function");
    }
  });
});

describe("transformRequest", () => {
  it("should transform OpenAI request to Gemini format", () => {
    const openaiRequest: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
    };

    const result = transformRequest("openai", "gemini", openaiRequest);

    expect(result).toBeDefined();
    expect((result as { contents: unknown[] }).contents).toBeDefined();
  });

  it("should transform OpenAI request to Ollama format", () => {
    const openaiRequest: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = transformRequest("openai", "ollama", openaiRequest);

    expect(result).toBeDefined();
    expect((result as { model: string }).model).toBe("gpt-4");
  });

  it("should throw for unknown source provider", () => {
    expect(() => transformRequest("unknown" as "openai", "gemini", {})).toThrow(
      ConfigurationError,
    );
  });

  it("should throw for unknown target provider", () => {
    expect(() => transformRequest("openai", "unknown" as "gemini", {})).toThrow(
      ConfigurationError,
    );
  });
});

describe("getTransformers", () => {
  it("should return transformer functions for valid providers", () => {
    const result = getTransformers("openai", "gemini");

    expect(typeof result.transformRequest).toBe("function");
    expect(typeof result.transformResponse).toBe("function");
  });

  it("should work for same-provider transforms", () => {
    const request: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const { transformRequest: transform } = getTransformers("openai", "openai");
    const result = transform(request) as ChatCompletionRequest;

    expect(result.model).toBe("gpt-4");
    expect(result.messages).toHaveLength(1);
  });
});

describe("toCanonical / fromCanonical", () => {
  it("should convert to and from canonical format", () => {
    const request: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
    };

    const canonical = toCanonical("openai", request);

    expect(canonical.model).toBe("gpt-4");
    expect(canonical.messages).toHaveLength(1);
    expect(canonical.config?.temperature).toBe(0.7);

    const restored = fromCanonical(
      "openai",
      canonical,
    ) as ChatCompletionRequest;

    expect(restored.model).toBe("gpt-4");
    expect(restored.temperature).toBe(0.7);
  });

  it("should throw for unknown provider", () => {
    expect(() => toCanonical("unknown" as "openai", {})).toThrow(
      ConfigurationError,
    );
  });
});
