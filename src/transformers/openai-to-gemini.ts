import { randomUUID } from "crypto";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionMessageParam,
} from "../types/openai.types";
import type {
  Content,
  GenerateContentRequest,
  GenerateContentResponse,
  GenerationConfig,
  Part,
  GeminiRole,
} from "../types/gemini.types";

// ============ REQUEST TRANSFORM ============

export function openaiToGeminiRequest(
  request: ChatCompletionRequest,
): GenerateContentRequest {
  const systemMessage = request.messages.find(
    (m): m is Extract<ChatCompletionMessageParam, { role: "system" }> =>
      m.role === "system",
  );

  const contents: Content[] = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: mapRoleToGemini(m.role),
      parts: extractParts(m),
    }));

  const generationConfig = buildGenerationConfig(request);

  return {
    contents,
    ...(systemMessage && {
      systemInstruction: {
        role: "user" as GeminiRole,
        parts: [{ text: extractTextContent(systemMessage.content) }],
      },
    }),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
  };
}

function mapRoleToGemini(role: string): GeminiRole {
  switch (role) {
    case "assistant":
      return "model";
    case "user":
    case "tool":
    default:
      return "user";
  }
}

function extractParts(message: ChatCompletionMessageParam): Part[] {
  if (!("content" in message) || message.content === null) {
    return [{ text: "" }];
  }

  const content = message.content;

  if (typeof content === "string") {
    return [{ text: content }];
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text") {
        return { text: part.text };
      }
      if (part.type === "image_url" && part.image_url) {
        const url = part.image_url.url;
        if (url.startsWith("data:")) {
          const [meta, data] = url.split(",");
          const mimeType = meta.split(":")[1]?.split(";")[0] || "image/png";
          return {
            inlineData: {
              mimeType,
              data,
            },
          };
        }
        return { text: `[Image: ${url}]` };
      }
      return { text: "" };
    });
  }

  return [{ text: "" }];
}

function extractTextContent(
  content: string | Array<{ type: string; text?: string }> | null | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

function buildGenerationConfig(
  request: ChatCompletionRequest,
): GenerationConfig {
  const config: GenerationConfig = {};

  if (request.temperature !== undefined && request.temperature !== null) {
    config.temperature = request.temperature;
  }
  if (request.max_tokens !== undefined && request.max_tokens !== null) {
    config.maxOutputTokens = request.max_tokens;
  }
  if (request.top_p !== undefined && request.top_p !== null) {
    config.topP = request.top_p;
  }
  if (request.stop) {
    config.stopSequences = Array.isArray(request.stop)
      ? request.stop
      : [request.stop];
  }
  if (request.n !== undefined && request.n !== null) {
    config.candidateCount = request.n;
  }

  return config;
}

// ============ RESPONSE TRANSFORM ============

export function geminiToOpenaiResponse(
  response: GenerateContentResponse,
  model: string,
): ChatCompletionResponse {
  const candidate = response.candidates?.[0];
  const content = candidate?.content;
  const textPart = content?.parts?.find(
    (p): p is { text: string } => "text" in p,
  );

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
          content: textPart?.text ?? "",
          refusal: null,
        },
        finish_reason: mapFinishReason(candidate?.finishReason),
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: response.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

function mapFinishReason(
  reason: string | undefined,
): "stop" | "length" | "tool_calls" | "content_filter" {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    default:
      return "stop";
  }
}
