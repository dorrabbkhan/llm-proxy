import { randomUUID } from "crypto";
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentPart,
  CanonicalError,
  CanonicalErrorKind,
  CanonicalFinishReason,
  CanonicalImage,
  CanonicalModelList,
  ProviderAdapter,
  StreamDecoder,
  StreamEncoder,
  StreamEncoderContext,
  IdGenerator,
} from "../../types/canonical.types";
import {
  kindFromStatus,
  makeCanonicalError,
} from "../../utils/canonical-error";
import { NotSupportedError } from "../../utils/errors";
import type {
  MessageCreateParams,
  Message,
  MessageParam,
  ContentBlock,
} from "../../types/anthropic.types";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export const anthropicAdapter: ProviderAdapter<MessageCreateParams, Message> = {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
  toCanonicalModelList,
  fromCanonicalModelList,
  toCanonicalError,
  fromCanonicalError,
  createStreamDecoder,
  createStreamEncoder,
};

// ============ REQUEST: Anthropic → Canonical ============

export function toCanonicalRequest(
  request: MessageCreateParams,
): CanonicalRequest {
  const messages: CanonicalMessage[] = request.messages.map((m) => ({
    role: m.role as CanonicalMessage["role"],
    content: extractContent(m.content),
  }));

  // Add system as first message if present
  if (request.system) {
    const systemContent =
      typeof request.system === "string"
        ? request.system
        : request.system
            .filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            )
            .map((b) => b.text)
            .join("\n");

    messages.unshift({
      role: "system",
      content: systemContent,
    });
  }

  const result: CanonicalRequest = {
    model: request.model,
    messages,
    // Canonical treats absent and stream:false identically — only an
    // explicit true turns streaming on.
    ...(request.stream === true && { stream: true }),
    ...(request.system && {
      systemPrompt:
        typeof request.system === "string"
          ? request.system
          : request.system
              .filter(
                (b): b is { type: "text"; text: string } => b.type === "text",
              )
              .map((b) => b.text)
              .join("\n"),
    }),
    config: {
      maxTokens: request.max_tokens,
      ...(request.temperature !== undefined && {
        temperature: request.temperature,
      }),
      ...(request.top_p !== undefined && { topP: request.top_p }),
      ...(request.top_k !== undefined && { topK: request.top_k }),
      ...(request.stop_sequences && { stopSequences: request.stop_sequences }),
    },
  };

  return result;
}

function extractContent(
  content: MessageParam["content"],
): string | CanonicalContentPart[] {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block): CanonicalContentPart => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "image" && "source" in block) {
      const source = block.source as {
        type: string;
        media_type?: string;
        data?: string;
      };
      if (source.type === "base64" && source.data) {
        return {
          type: "image",
          image: {
            data: source.data,
            mimeType: (source.media_type ||
              "image/png") as CanonicalImage["mimeType"],
          },
        };
      }
    }
    return { type: "text", text: "" };
  });
}

// ============ REQUEST: Canonical → Anthropic ============

export function fromCanonicalRequest(
  request: CanonicalRequest,
): MessageCreateParams {
  const messages: MessageParam[] = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: convertToAnthropicContent(m.content),
    }));

  const systemPrompt =
    request.systemPrompt ||
    request.messages.find((m) => m.role === "system")?.content;

  const result: MessageCreateParams = {
    model: request.model,
    messages,
    max_tokens: request.config?.maxTokens ?? 4096,
    ...(systemPrompt &&
      typeof systemPrompt === "string" && { system: systemPrompt }),
    ...(request.config?.temperature !== undefined && {
      temperature: request.config.temperature,
    }),
    ...(request.config?.topP !== undefined && { top_p: request.config.topP }),
    ...(request.config?.topK !== undefined && { top_k: request.config.topK }),
    ...(request.config?.stopSequences && {
      stop_sequences: request.config.stopSequences,
    }),
  };

  return result;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: ImageMediaType; data: string };
    };

function convertToAnthropicContent(
  content: string | CanonicalContentPart[],
): string | AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content;
  }

  const blocks: AnthropicContentBlock[] = content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text || "" };
    }
    if (part.type === "image" && part.image) {
      return {
        type: "image",
        source: {
          type: "base64" as const,
          media_type: validateMediaType(part.image.mimeType),
          data: part.image.data,
        },
      };
    }
    return { type: "text", text: "" };
  });

  // If only one text block, return as string
  if (blocks.length === 1 && blocks[0].type === "text") {
    return blocks[0].text;
  }

  return blocks;
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

// ============ RESPONSE: Anthropic → Canonical ============

export function toCanonicalResponse(
  response: Message,
  model: string,
): CanonicalResponse {
  const textContent = response.content
    .filter(
      (block): block is ContentBlock & { type: "text" } =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");

  return {
    id: response.id || `anthropic-${randomUUID()}`,
    model,
    message: {
      role: "assistant",
      content: textContent,
    },
    finishReason: mapFinishReason(response.stop_reason),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

function mapFinishReason(reason: string | null): CanonicalFinishReason {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_call";
    default:
      return "stop";
  }
}

// ============ RESPONSE: Canonical → Anthropic ============

export function fromCanonicalResponse(response: CanonicalResponse): Message {
  const content =
    typeof response.message.content === "string"
      ? response.message.content
      : "";

  return {
    id: response.id || `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: content }],
    model: response.model,
    stop_reason: mapToAnthropicStopReason(response.finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
    },
  } as Message;
}

// ============ MODEL LIST (/v1/models) ============

interface AnthropicModelListResponse {
  data?: {
    id?: string;
    display_name?: string;
    created_at?: string;
    type?: string;
  }[];
  has_more?: boolean;
}

export function toCanonicalModelList(response: unknown): CanonicalModelList {
  const res = response as AnthropicModelListResponse;
  return {
    models: (res.data ?? [])
      .filter(
        (m): m is { id: string; display_name?: string; created_at?: string } =>
          Boolean(m.id),
      )
      .map((m) => ({
        id: m.id,
        displayName: m.display_name,
        // ISO timestamp → Unix seconds
        created: m.created_at
          ? Math.floor(Date.parse(m.created_at) / 1000)
          : undefined,
      })),
  };
}

export function fromCanonicalModelList(
  list: CanonicalModelList,
): AnthropicModelListResponse {
  return {
    data: list.models.map((m) => ({
      id: m.id,
      display_name: m.displayName,
      created_at: m.created
        ? new Date(m.created * 1000).toISOString()
        : undefined,
      type: "model",
    })),
    has_more: false,
  };
}

function mapToAnthropicStopReason(
  reason: CanonicalFinishReason,
): "end_turn" | "max_tokens" | "tool_use" | null {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_call":
      return "tool_use";
    default:
      return "end_turn";
  }
}

// ============ ERRORS ============

const ANTHROPIC_ERROR_TYPE: Record<CanonicalErrorKind, string> = {
  invalid_request: "invalid_request_error",
  authentication: "authentication_error",
  permission: "permission_error",
  not_found: "not_found_error",
  request_too_large: "request_too_large",
  rate_limit: "rate_limit_error",
  unsupported: "api_error",
  upstream: "api_error",
  unavailable: "overloaded_error",
  timeout: "timeout_error",
  internal: "api_error",
};

export function toCanonicalError(
  status: number,
  body: unknown,
): CanonicalError {
  const err = (body as { error?: { message?: unknown } } | null)?.error;
  const message =
    typeof err?.message === "string" && err.message.length > 0
      ? err.message
      : `Upstream anthropic returned ${status}`;
  return makeCanonicalError(kindFromStatus(status), message);
}

export function fromCanonicalError(err: CanonicalError): unknown {
  return {
    type: "error",
    error: {
      type: ANTHROPIC_ERROR_TYPE[err.kind],
      message: err.message,
    },
  };
}

// ============ STREAMING (stub — Task 5) ============

export function createStreamDecoder(
  _model: string,
  _ids?: IdGenerator,
): StreamDecoder {
  throw new NotSupportedError(
    'Streaming is not supported yet (planned for v1.1). Send "stream": false.',
  );
}

export function createStreamEncoder(
  _ctx: StreamEncoderContext<MessageCreateParams>,
): StreamEncoder {
  throw new NotSupportedError(
    'Streaming is not supported yet (planned for v1.1). Send "stream": false.',
  );
}
