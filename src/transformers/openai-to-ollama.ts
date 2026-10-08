import { randomUUID } from "crypto";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionMessageParam,
} from "../types/openai.types";
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
  OllamaOptions,
} from "../types/ollama.types";

// ============ REQUEST TRANSFORM ============

export function openaiToOllamaRequest(
  request: ChatCompletionRequest,
): OllamaChatRequest {
  const messages: OllamaMessage[] = request.messages.map((m) =>
    convertMessage(m),
  );

  const options = buildOptions(request);

  const result: OllamaChatRequest = {
    model: request.model,
    messages,
  };

  if (request.stream === true || request.stream === false) {
    result.stream = request.stream;
  }

  if (Object.keys(options).length > 0) {
    result.options = options;
  }

  return result;
}

function convertMessage(message: ChatCompletionMessageParam): OllamaMessage {
  const content = extractContent(message);
  const images = extractImages(message);

  return {
    role: message.role as "system" | "user" | "assistant",
    content,
    ...(images.length > 0 && { images }),
  };
}

function extractContent(message: ChatCompletionMessageParam): string {
  if (!("content" in message) || message.content === null) {
    return "";
  }

  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  }

  return "";
}

function extractImages(message: ChatCompletionMessageParam): string[] {
  if (!("content" in message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content
    .filter(
      (p): p is { type: "image_url"; image_url: { url: string } } =>
        p.type === "image_url",
    )
    .map((p) => {
      const url = p.image_url.url;
      if (url.startsWith("data:")) {
        return url.split(",")[1] || "";
      }
      return url;
    })
    .filter((img) => img.length > 0);
}

function buildOptions(request: ChatCompletionRequest): OllamaOptions {
  const options: OllamaOptions = {};

  if (request.temperature !== undefined && request.temperature !== null) {
    options.temperature = request.temperature;
  }
  if (request.max_tokens !== undefined && request.max_tokens !== null) {
    options.num_predict = request.max_tokens;
  }
  if (request.top_p !== undefined && request.top_p !== null) {
    options.top_p = request.top_p;
  }
  if (request.stop) {
    options.stop = Array.isArray(request.stop) ? request.stop : [request.stop];
  }

  return options;
}

// ============ RESPONSE TRANSFORM ============

export function ollamaToOpenaiResponse(
  response: OllamaChatResponse,
  model: string,
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.message?.content ?? "",
          refusal: null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: response.prompt_eval_count ?? 0,
      completion_tokens: response.eval_count ?? 0,
      total_tokens:
        (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
    },
  };
}
