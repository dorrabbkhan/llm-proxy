import { describe, it, expect } from "vitest";
import {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
} from "./ollama.adapter";
import type {
  CanonicalRequest,
  CanonicalResponse,
} from "../../types/canonical.types";
import type {
  OllamaChatRequest,
  OllamaChatResponse,
} from "../../types/ollama.types";

describe("Ollama Adapter", () => {
  describe("toCanonicalRequest", () => {
    it("should convert basic request", () => {
      const input: OllamaChatRequest = {
        model: "llama2",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = toCanonicalRequest(input);

      expect(result.model).toBe("llama2");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toBe("Hello");
    });

    it("should extract system prompt", () => {
      const input: OllamaChatRequest = {
        model: "llama2",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
        ],
      };

      const result = toCanonicalRequest(input);

      expect(result.systemPrompt).toBe("You are helpful");
    });

    it("should convert options to config", () => {
      const input: OllamaChatRequest = {
        model: "llama2",
        messages: [{ role: "user", content: "Hello" }],
        options: {
          temperature: 0.7,
          num_predict: 100,
          top_p: 0.9,
          top_k: 40,
          stop: ["END"],
          seed: 42,
        },
      };

      const result = toCanonicalRequest(input);

      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.maxTokens).toBe(100);
      expect(result.config?.topP).toBe(0.9);
      expect(result.config?.topK).toBe(40);
      expect(result.config?.stopSequences).toEqual(["END"]);
      expect(result.config?.seed).toBe(42);
    });

    it("should handle messages with images", () => {
      const input: OllamaChatRequest = {
        model: "llava",
        messages: [
          {
            role: "user",
            content: "What is this?",
            images: ["abc123"],
          },
        ],
      };

      const result = toCanonicalRequest(input);
      const content = result.messages[0].content;

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({ type: "text", text: "What is this?" });
        expect(content[1].type).toBe("image");
        expect(content[1].image?.data).toBe("abc123");
      }
    });

    it("should pass through stream parameter", () => {
      const input: OllamaChatRequest = {
        model: "llama2",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      };

      const result = toCanonicalRequest(input);

      expect(result.stream).toBe(true);
    });
  });

  describe("fromCanonicalRequest", () => {
    it("should convert basic canonical request", () => {
      const input: CanonicalRequest = {
        model: "llama2",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = fromCanonicalRequest(input);

      expect(result.model).toBe("llama2");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].role).toBe("user");
      expect(result.messages![0].content).toBe("Hello");
    });

    it("should convert config to options", () => {
      const input: CanonicalRequest = {
        model: "llama2",
        messages: [{ role: "user", content: "Hello" }],
        config: {
          temperature: 0.7,
          maxTokens: 100,
          topP: 0.9,
          topK: 40,
          stopSequences: ["END"],
          seed: 42,
        },
      };

      const result = fromCanonicalRequest(input);

      expect(result.options?.temperature).toBe(0.7);
      expect(result.options?.num_predict).toBe(100);
      expect(result.options?.top_p).toBe(0.9);
      expect(result.options?.top_k).toBe(40);
      expect(result.options?.stop).toEqual(["END"]);
      expect(result.options?.seed).toBe(42);
    });

    it("should handle multipart content with images", () => {
      const input: CanonicalRequest = {
        model: "llava",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is this?" },
              {
                type: "image",
                image: { data: "abc123", mimeType: "image/png" },
              },
            ],
          },
        ],
      };

      const result = fromCanonicalRequest(input);

      expect(result.messages![0].content).toBe("What is this?");
      expect(result.messages![0].images).toEqual(["abc123"]);
    });

    it("should pass through stream parameter", () => {
      const input: CanonicalRequest = {
        model: "llama2",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      };

      const result = fromCanonicalRequest(input);

      expect(result.stream).toBe(true);
    });
  });

  describe("toCanonicalResponse", () => {
    it("should convert basic response", () => {
      const input = {
        model: "llama2",
        created_at: new Date(),
        message: { role: "assistant", content: "Hello!" },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      } as OllamaChatResponse;

      const result = toCanonicalResponse(input, "llama2");

      expect(result.model).toBe("llama2");
      expect(result.message.role).toBe("assistant");
      expect(result.message.content).toBe("Hello!");
      expect(result.finishReason).toBe("stop");
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
      expect(result.usage?.totalTokens).toBe(15);
    });

    it("should generate valid id", () => {
      const input = {
        model: "llama2",
        created_at: new Date(),
        message: { role: "assistant", content: "Hi" },
        done: true,
      } as OllamaChatResponse;

      const result = toCanonicalResponse(input, "llama2");

      expect(result.id).toMatch(/^ollama-/);
    });

    it("should handle missing usage counts", () => {
      const input = {
        model: "llama2",
        created_at: new Date(),
        message: { role: "assistant", content: "Hi" },
        done: true,
      } as OllamaChatResponse;

      const result = toCanonicalResponse(input, "llama2");

      expect(result.usage?.inputTokens).toBe(0);
      expect(result.usage?.outputTokens).toBe(0);
    });

    it("should set unknown finish reason when not done", () => {
      const input = {
        model: "llama2",
        created_at: new Date(),
        message: { role: "assistant", content: "Hi" },
        done: false,
      } as OllamaChatResponse;

      const result = toCanonicalResponse(input, "llama2");

      expect(result.finishReason).toBe("unknown");
    });
  });

  describe("fromCanonicalResponse", () => {
    it("should convert canonical response to Ollama format", () => {
      const input: CanonicalResponse = {
        id: "test-123",
        model: "llama2",
        message: { role: "assistant", content: "Hello!" },
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      const result = fromCanonicalResponse(input);

      expect(result.model).toBe("llama2");
      expect(result.message.content).toBe("Hello!");
      expect(result.done).toBe(true);
      expect(result.prompt_eval_count).toBe(10);
      expect(result.eval_count).toBe(5);
    });

    it("should set done based on finish reason", () => {
      const stopResponse: CanonicalResponse = {
        id: "test",
        model: "llama2",
        message: { role: "assistant", content: "" },
        finishReason: "stop",
      };

      const lengthResponse: CanonicalResponse = {
        id: "test",
        model: "llama2",
        message: { role: "assistant", content: "" },
        finishReason: "length",
      };

      expect(fromCanonicalResponse(stopResponse).done).toBe(true);
      expect(fromCanonicalResponse(lengthResponse).done).toBe(false);
    });
  });

  describe("roundtrip", () => {
    it("should preserve data through request roundtrip", () => {
      const original: OllamaChatRequest = {
        model: "llama2",
        messages: [
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hello" },
        ],
        options: {
          temperature: 0.7,
          num_predict: 100,
        },
      };

      const canonical = toCanonicalRequest(original);
      const result = fromCanonicalRequest(canonical);

      expect(result.model).toBe(original.model);
      expect(result.messages!.length).toBe(original.messages!.length);
      expect(result.options?.temperature).toBe(original.options?.temperature);
      expect(result.options?.num_predict).toBe(original.options?.num_predict);
    });
  });
});
