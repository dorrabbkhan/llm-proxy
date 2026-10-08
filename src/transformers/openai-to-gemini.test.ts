import { describe, it, expect } from "vitest";
import { FinishReason } from "@google/generative-ai";
import {
  openaiToGeminiRequest,
  geminiToOpenaiResponse,
} from "./openai-to-gemini";
import type { ChatCompletionRequest } from "../types/openai.types";
import type { GenerateContentResponse, Content } from "../types/gemini.types";

describe("openaiToGeminiRequest", () => {
  it("should convert basic chat request", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = openaiToGeminiRequest(input);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe("user");
    expect(result.contents[0].parts[0]).toEqual({ text: "Hello" });
  });

  it("should extract system message to systemInstruction", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ],
    };

    const result = openaiToGeminiRequest(input);

    expect((result.systemInstruction as Content)?.parts[0]).toEqual({
      text: "You are helpful",
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe("user");
  });

  it("should map assistant role to model", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
    };

    const result = openaiToGeminiRequest(input);

    expect(result.contents).toHaveLength(2);
    expect(result.contents[0].role).toBe("user");
    expect(result.contents[1].role).toBe("model");
  });

  it("should convert generation parameters", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
      max_tokens: 100,
      top_p: 0.9,
      stop: ["END"],
    };

    const result = openaiToGeminiRequest(input);

    expect(result.generationConfig?.temperature).toBe(0.7);
    expect(result.generationConfig?.maxOutputTokens).toBe(100);
    expect(result.generationConfig?.topP).toBe(0.9);
    expect(result.generationConfig?.stopSequences).toEqual(["END"]);
  });

  it("should handle stop as string", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      stop: "STOP",
    };

    const result = openaiToGeminiRequest(input);

    expect(result.generationConfig?.stopSequences).toEqual(["STOP"]);
  });

  it("should handle n parameter as candidateCount", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      n: 3,
    };

    const result = openaiToGeminiRequest(input);

    expect(result.generationConfig?.candidateCount).toBe(3);
  });

  it("should handle multipart content array", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc123" },
            },
          ],
        },
      ],
    };

    const result = openaiToGeminiRequest(input);

    expect(result.contents[0].parts).toHaveLength(2);
    expect(result.contents[0].parts[0]).toEqual({
      text: "What is in this image?",
    });
    expect(result.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/png", data: "abc123" },
    });
  });

  it("should handle empty messages array", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [],
    };

    const result = openaiToGeminiRequest(input);

    expect(result.contents).toHaveLength(0);
  });

  it("should not include generationConfig if no params set", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = openaiToGeminiRequest(input);

    expect(result.generationConfig).toBeUndefined();
  });
});

describe("geminiToOpenaiResponse", () => {
  it("should convert basic response", () => {
    const input: GenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello there!" }],
          },
          finishReason: FinishReason.STOP,
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("gemini-pro");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("Hello there!");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBe(5);
    expect(result.usage?.total_tokens).toBe(15);
  });

  it("should generate valid id", () => {
    const input: GenerateContentResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hi" }] },
          index: 0,
        },
      ],
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");

    expect(result.id).toMatch(/^chatcmpl-/);
  });

  it("should map MAX_TOKENS to length", () => {
    const input: GenerateContentResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hi" }] },
          finishReason: FinishReason.MAX_TOKENS,
          index: 0,
        },
      ],
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");

    expect(result.choices[0].finish_reason).toBe("length");
  });

  it("should map SAFETY to content_filter", () => {
    const input: GenerateContentResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "" }] },
          finishReason: FinishReason.SAFETY,
          index: 0,
        },
      ],
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");

    expect(result.choices[0].finish_reason).toBe("content_filter");
  });

  it("should handle missing usage metadata", () => {
    const input: GenerateContentResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hi" }] },
          index: 0,
        },
      ],
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");

    expect(result.usage?.prompt_tokens).toBe(0);
    expect(result.usage?.completion_tokens).toBe(0);
  });

  it("should handle empty candidates", () => {
    const input: GenerateContentResponse = {
      candidates: [],
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");

    expect(result.choices[0].message.content).toBe("");
  });

  it("should set created timestamp", () => {
    const before = Math.floor(Date.now() / 1000);
    const input: GenerateContentResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hi" }] },
          index: 0,
        },
      ],
    };

    const result = geminiToOpenaiResponse(input, "gemini-pro");
    const after = Math.floor(Date.now() / 1000);

    expect(result.created).toBeGreaterThanOrEqual(before);
    expect(result.created).toBeLessThanOrEqual(after);
  });
});
