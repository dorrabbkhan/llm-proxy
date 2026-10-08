import { randomUUID } from "crypto";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionMessageParam,
} from "../types/openai.types";
import type {
  MessageCreateParams,
  Message,
  MessageParam,
  ContentBlock,
} from "../types/anthropic.types";

// ============ REQUEST TRANSFORM ============

export function openaiToAnthropicRequest(
  request: ChatCompletionRequest,
): MessageCreateParams {
  const systemMessage = request.messages.find(
    (m): m is Extract<ChatCompletionMessageParam, { role: "system" }> =>
      m.role === "system",
  );

  const messages: MessageParam[] = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => convertMessage(m));

  return {
    model: mapModel(request.model),
    messages,
    max_tokens: request.max_tokens ?? 4096,
    ...(systemMessage && { system: extractTextContent(systemMessage.content) }),
    ...(request.temperature !== undefined &&
      request.temperature !== null && { temperature: request.temperature }),
    ...(request.top_p !== undefined &&
      request.top_p !== null && { top_p: request.top_p }),
    ...(request.stop && {
      stop_sequences: Array.isArray(request.stop)
        ? request.stop
        : [request.stop],
    }),
  };
}

function mapModel(model: string): string {
  const modelMap: Record<string, string> = {
    "gpt-4": "claude-3-opus-20240229",
    "gpt-4-turbo": "claude-3-opus-20240229",
    "gpt-4o": "claude-3-5-sonnet-20241022",
    "gpt-4o-mini": "claude-3-5-haiku-20241022",
    "gpt-3.5-turbo": "claude-3-haiku-20240307",
  };
  return modelMap[model] || model;
}

function convertMessage(message: ChatCompletionMessageParam): MessageParam {
  const role = message.role === "assistant" ? "assistant" : "user";
  const content = extractContent(message);

  return {
    role,
    content,
  };
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: ImageMediaType; data: string };
    };

function extractContent(
  message: ChatCompletionMessageParam,
): string | ContentPart[] {
  if (!("content" in message) || message.content === null) {
    return "";
  }

  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: ContentPart[] = [];

    for (const part of content) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text });
      } else if (part.type === "image_url" && part.image_url) {
        const url = part.image_url.url;
        if (url.startsWith("data:")) {
          const [meta, data] = url.split(",");
          const rawMediaType = meta.split(":")[1]?.split(";")[0] || "image/png";
          const mediaType = validateMediaType(rawMediaType);
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data,
            },
          });
        }
      }
    }

    return parts.length === 1 && parts[0].type === "text"
      ? parts[0].text
      : parts;
  }

  return "";
}

function validateMediaType(type: string): ImageMediaType {
  const validTypes: ImageMediaType[] = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  return validTypes.includes(type as ImageMediaType)
    ? (type as ImageMediaType)
    : "image/png";
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

// ============ RESPONSE TRANSFORM ============

export function anthropicToOpenaiResponse(
  response: Message,
  model: string,
): ChatCompletionResponse {
  const textContent = response.content
    .filter(
      (block): block is ContentBlock & { type: "text" } =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");

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
          content: textContent,
          refusal: null,
        },
        finish_reason: mapStopReason(response.stop_reason),
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

function mapStopReason(
  reason: string | null,
): "stop" | "length" | "tool_calls" | "content_filter" {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}
