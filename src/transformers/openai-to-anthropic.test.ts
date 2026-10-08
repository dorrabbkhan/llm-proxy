import { describe, it, expect } from "vitest";
import {
  openaiToAnthropicRequest,
  anthropicToOpenaiResponse,
} from "./openai-to-anthropic";
import type { ChatCompletionRequest } from "../types/openai.types";
import type { Message } from "../types/anthropic.types";

// Helper to create test Message objects with minimal required fields
function createTestMessage(
  overrides: Partial<Message> & { content: Message["content"] },
): Message {
  return {
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "claude-3-opus-20240229",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
    ...overrides,
  } as Message;
}

describe("openaiToAnthropicRequest", () => {
  it("should convert basic chat request", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = openaiToAnthropicRequest(input);

    expect(result.model).toBe("claude-3-opus-20240229");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe("Hello");
    expect(result.max_tokens).toBe(4096);
  });

  it("should extract system message", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ],
    };

    const result = openaiToAnthropicRequest(input);

    expect(result.system).toBe("You are helpful");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("should map OpenAI models to Claude models", () => {
    const models: Array<{ input: string; expected: string }> = [
      { input: "gpt-4", expected: "claude-3-opus-20240229" },
      { input: "gpt-4o", expected: "claude-3-5-sonnet-20241022" },
      { input: "gpt-4o-mini", expected: "claude-3-5-haiku-20241022" },
      { input: "gpt-3.5-turbo", expected: "claude-3-haiku-20240307" },
      { input: "claude-3-sonnet", expected: "claude-3-sonnet" },
    ];

    for (const { input, expected } of models) {
      const request: ChatCompletionRequest = {
        model: input,
        messages: [{ role: "user", content: "Hi" }],
      };
      const result = openaiToAnthropicRequest(request);
      expect(result.model).toBe(expected);
    }
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

    const result = openaiToAnthropicRequest(input);

    expect(result.temperature).toBe(0.7);
    expect(result.max_tokens).toBe(100);
    expect(result.top_p).toBe(0.9);
    expect(result.stop_sequences).toEqual(["END"]);
  });

  it("should handle stop as string", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      stop: "STOP",
    };

    const result = openaiToAnthropicRequest(input);

    expect(result.stop_sequences).toEqual(["STOP"]);
  });

  it("should handle multipart content with images", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
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

    const result = openaiToAnthropicRequest(input);
    const content = result.messages[0].content;

    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "What is this?" });
      expect(content[1]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "abc123",
        },
      });
    }
  });

  it("should map assistant role correctly", () => {
    const input: ChatCompletionRequest = {
      model: "gpt-4",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ],
    };

    const result = openaiToAnthropicRequest(input);

    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].role).toBe("assistant");
  });
});

describe("anthropicToOpenaiResponse", () => {
  it("should convert basic response", () => {
    const input = createTestMessage({
      content: [{ type: "text", text: "Hello there!" }] as Message["content"],
      usage: { input_tokens: 10, output_tokens: 5 } as Message["usage"],
    });

    const result = anthropicToOpenaiResponse(input, "claude-3-opus");

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("claude-3-opus");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("Hello there!");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBe(5);
    expect(result.usage?.total_tokens).toBe(15);
  });

  it("should generate valid id", () => {
    const input = createTestMessage({
      content: [{ type: "text", text: "Hi" }] as Message["content"],
    });

    const result = anthropicToOpenaiResponse(input, "claude-3-opus");

    expect(result.id).toMatch(/^chatcmpl-/);
  });

  it("should map max_tokens to length", () => {
    const input = createTestMessage({
      content: [{ type: "text", text: "Hi" }] as Message["content"],
      stop_reason: "max_tokens",
    });

    const result = anthropicToOpenaiResponse(input, "claude-3-opus");

    expect(result.choices[0].finish_reason).toBe("length");
  });

  it("should map tool_use to tool_calls", () => {
    const input = createTestMessage({
      content: [{ type: "text", text: "" }] as Message["content"],
      stop_reason: "tool_use",
    });

    const result = anthropicToOpenaiResponse(input, "claude-3-opus");

    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("should concatenate multiple text blocks", () => {
    const input = createTestMessage({
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "World!" },
      ] as Message["content"],
      usage: { input_tokens: 1, output_tokens: 2 } as Message["usage"],
    });

    const result = anthropicToOpenaiResponse(input, "claude-3-opus");

    expect(result.choices[0].message.content).toBe("Hello World!");
  });

  it("should set created timestamp", () => {
    const before = Math.floor(Date.now() / 1000);
    const input = createTestMessage({
      content: [{ type: "text", text: "Hi" }] as Message["content"],
    });

    const result = anthropicToOpenaiResponse(input, "claude-3-opus");
    const after = Math.floor(Date.now() / 1000);

    expect(result.created).toBeGreaterThanOrEqual(before);
    expect(result.created).toBeLessThanOrEqual(after);
  });
});
