import { randomUUID } from "crypto";
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentPart,
  ProviderAdapter,
} from "../../types/canonical.types";
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
} from "../../types/ollama.types";

export const ollamaAdapter: ProviderAdapter<
  OllamaChatRequest,
  OllamaChatResponse
> = {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
};

// ============ REQUEST: Ollama → Canonical ============

export function toCanonicalRequest(
  request: OllamaChatRequest,
): CanonicalRequest {
  const messages: CanonicalMessage[] = (request.messages || []).map((m) => ({
    role: m.role as CanonicalMessage["role"],
    content: extractContent(m),
  }));

  // Extract system prompt from first system message
  const systemMsg = messages.find((m) => m.role === "system");
  const systemPrompt =
    typeof systemMsg?.content === "string" ? systemMsg.content : undefined;

  const result: CanonicalRequest = {
    model: request.model,
    messages,
    ...(systemPrompt && { systemPrompt }),
  };

  // Convert options to config
  if (request.options) {
    const opts = request.options;
    result.config = {
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      ...(opts.num_predict !== undefined && { maxTokens: opts.num_predict }),
      ...(opts.top_p !== undefined && { topP: opts.top_p }),
      ...(opts.top_k !== undefined && { topK: opts.top_k }),
      ...(opts.stop && { stopSequences: opts.stop }),
      ...(opts.seed !== undefined && { seed: opts.seed }),
    };
  }

  if (request.stream !== undefined) {
    result.stream = request.stream;
  }

  return result;
}

function extractContent(
  message: OllamaMessage,
): string | CanonicalContentPart[] {
  if (!message.images || message.images.length === 0) {
    return message.content;
  }

  // Has images - return multipart
  const parts: CanonicalContentPart[] = [
    { type: "text", text: message.content },
  ];

  for (const img of message.images) {
    // Ollama images can be string (base64) or Uint8Array
    const data =
      typeof img === "string" ? img : Buffer.from(img).toString("base64");
    parts.push({
      type: "image",
      image: {
        data,
        mimeType: "image/png", // Ollama doesn't specify mime type
      },
    });
  }

  return parts;
}

// ============ REQUEST: Canonical → Ollama ============

export function fromCanonicalRequest(
  request: CanonicalRequest,
): OllamaChatRequest {
  const messages: OllamaMessage[] = request.messages.map((m) =>
    convertToOllamaMessage(m),
  );

  const result: OllamaChatRequest = {
    model: request.model,
    messages,
  };

  // Convert config to options
  if (request.config) {
    const c = request.config;
    const options: OllamaChatRequest["options"] = {};

    if (c.temperature !== undefined) options.temperature = c.temperature;
    if (c.maxTokens !== undefined) options.num_predict = c.maxTokens;
    if (c.topP !== undefined) options.top_p = c.topP;
    if (c.topK !== undefined) options.top_k = c.topK;
    if (c.stopSequences) options.stop = c.stopSequences;
    if (c.seed !== undefined) options.seed = c.seed;

    if (Object.keys(options).length > 0) {
      result.options = options;
    }
  }

  if (request.stream !== undefined) {
    result.stream = request.stream;
  }

  return result;
}

function convertToOllamaMessage(msg: CanonicalMessage): OllamaMessage {
  const result: OllamaMessage = {
    role: msg.role as OllamaMessage["role"],
    content: "",
  };

  if (typeof msg.content === "string") {
    result.content = msg.content;
  } else if (Array.isArray(msg.content)) {
    // Extract text and images
    const textParts = msg.content
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join("\n");

    const images = msg.content
      .filter((p) => p.type === "image" && p.image)
      .map((p) => p.image!.data);

    result.content = textParts;
    if (images.length > 0) {
      result.images = images;
    }
  }

  return result;
}

// ============ RESPONSE: Ollama → Canonical ============

export function toCanonicalResponse(
  response: OllamaChatResponse,
  model: string,
): CanonicalResponse {
  return {
    id: `ollama-${randomUUID()}`,
    model,
    message: {
      role: "assistant",
      content: response.message?.content ?? "",
    },
    finishReason: response.done ? "stop" : "unknown",
    usage: {
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
      totalTokens:
        (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
    },
  };
}

// ============ RESPONSE: Canonical → Ollama ============

export function fromCanonicalResponse(
  response: CanonicalResponse,
): OllamaChatResponse {
  const content =
    typeof response.message.content === "string"
      ? response.message.content
      : "";

  return {
    model: response.model,
    created_at: new Date(),
    message: {
      role: "assistant",
      content,
    },
    done: response.finishReason === "stop",
    done_reason: response.finishReason === "stop" ? "stop" : "length",
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: response.usage?.inputTokens ?? 0,
    prompt_eval_duration: 0,
    eval_count: response.usage?.outputTokens ?? 0,
    eval_duration: 0,
  } as OllamaChatResponse;
}
