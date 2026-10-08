import { describe, it, expect } from "vitest";
import {
  openaiToOllamaRequest,
  ollamaToOpenaiResponse,
} from "./openai-to-ollama";
import type { ChatCompletionRequest } from "../types/openai.types";
import type { OllamaChatResponse } from "../types/ollama.types";

describe("openaiToOllamaRequest", () => {
  it("should convert basic chat request", () => {
    const input: ChatCompletionRequest = {
      model: "llama2",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = openaiToOllamaRequest(input);

    expect(result.model).toBe("llama2");
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0].role).toBe("user");
    expect(result.messages![0].content).toBe("Hello");
  });

  it("should preserve all message roles", () => {
    const input: ChatCompletionRequest = {
      model: "llama2",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ],
    };

    const result = openaiToOllamaRequest(input);

    expect(result.messages).toHaveLength(3);
    expect(result.messages![0].role).toBe("system");
    expect(result.messages![1].role).toBe("user");
    expect(result.messages![2].role).toBe("assistant");
  });

  it("should convert generation parameters to options", () => {
    const input: ChatCompletionRequest = {
      model: "llama2",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
      max_tokens: 100,
      top_p: 0.9,
      stop: ["END"],
    };

    const result = openaiToOllamaRequest(input);

    expect(result.options?.temperature).toBe(0.7);
    expect(result.options?.num_predict).toBe(100);
    expect(result.options?.top_p).toBe(0.9);
    expect(result.options?.stop).toEqual(["END"]);
  });

  it("should handle stop as string", () => {
    const input: ChatCompletionRequest = {
      model: "llama2",
      messages: [{ role: "user", content: "Hello" }],
      stop: "STOP",
    };

    const result = openaiToOllamaRequest(input);

    expect(result.options?.stop).toEqual(["STOP"]);
  });

  it("should pass through stream parameter", () => {
    const input: ChatCompletionRequest = {
      model: "llama2",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    };

    const result = openaiToOllamaRequest(input);

    expect(result.stream).toBe(true);
  });

  it("should handle multipart content with images", () => {
    const input: ChatCompletionRequest = {
      model: "llava",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc123" },
            },
          ],
        },
      ],
    };

    const result = openaiToOllamaRequest(input);

    expect(result.messages![0].content).toBe("What is this?");
    expect(result.messages![0].images).toEqual(["abc123"]);
  });

  it("should not include options if no params set", () => {
    const input: ChatCompletionRequest = {
      model: "llama2",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = openaiToOllamaRequest(input);

    expect(result.options).toBeUndefined();
  });
});

describe("ollamaToOpenaiResponse", () => {
  it("should convert basic response", () => {
    const input = {
      model: "llama2",
      created_at: new Date("2024-01-01T00:00:00Z"),
      message: {
        role: "assistant",
        content: "Hello there!",
      },
      done: true,
      prompt_eval_count: 10,
      eval_count: 5,
    } as OllamaChatResponse;

    const result = ollamaToOpenaiResponse(input, "llama2");

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("llama2");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("Hello there!");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBe(5);
    expect(result.usage?.total_tokens).toBe(15);
  });

  it("should generate valid id", () => {
    const input = {
      model: "llama2",
      created_at: new Date("2024-01-01T00:00:00Z"),
      message: { role: "assistant", content: "Hi" },
      done: true,
    } as OllamaChatResponse;

    const result = ollamaToOpenaiResponse(input, "llama2");

    expect(result.id).toMatch(/^chatcmpl-/);
  });

  it("should handle missing usage counts", () => {
    const input = {
      model: "llama2",
      created_at: new Date("2024-01-01T00:00:00Z"),
      message: { role: "assistant", content: "Hi" },
      done: true,
    } as OllamaChatResponse;

    const result = ollamaToOpenaiResponse(input, "llama2");

    expect(result.usage?.prompt_tokens).toBe(0);
    expect(result.usage?.completion_tokens).toBe(0);
    expect(result.usage?.total_tokens).toBe(0);
  });

  it("should set created timestamp", () => {
    const before = Math.floor(Date.now() / 1000);
    const input = {
      model: "llama2",
      created_at: new Date("2024-01-01T00:00:00Z"),
      message: { role: "assistant", content: "Hi" },
      done: true,
    } as OllamaChatResponse;

    const result = ollamaToOpenaiResponse(input, "llama2");
    const after = Math.floor(Date.now() / 1000);

    expect(result.created).toBeGreaterThanOrEqual(before);
    expect(result.created).toBeLessThanOrEqual(after);
  });
});
