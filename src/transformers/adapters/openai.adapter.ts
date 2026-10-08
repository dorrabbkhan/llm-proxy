import { randomUUID } from "crypto";
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentPart,
  CanonicalImage,
  CanonicalToolCall,
  ProviderAdapter,
} from "../../types/canonical.types";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionMessageParam,
} from "../../types/openai.types";

export const openaiAdapter: ProviderAdapter<
  ChatCompletionRequest,
  ChatCompletionResponse
> = {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
};

// ============ REQUEST: OpenAI → Canonical ============

export function toCanonicalRequest(
  request: ChatCompletionRequest,
): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  let systemPrompt: string | undefined;

  for (const msg of request.messages) {
    if (msg.role === "system") {
      systemPrompt = extractTextContent(msg);
    }
    messages.push(convertToCanonicalMessage(msg));
  }

  return {
    model: request.model,
    messages,
    ...(systemPrompt && { systemPrompt }),
    config: {
      ...(request.temperature !== undefined &&
        request.temperature !== null && { temperature: request.temperature }),
      ...(request.max_tokens !== undefined &&
        request.max_tokens !== null && { maxTokens: request.max_tokens }),
      ...(request.top_p !== undefined &&
        request.top_p !== null && { topP: request.top_p }),
      ...(request.stop && {
        stopSequences: Array.isArray(request.stop)
          ? request.stop
          : [request.stop],
      }),
      ...(request.n !== undefined &&
        request.n !== null && { candidateCount: request.n }),
      ...(request.seed !== undefined &&
        request.seed !== null && { seed: request.seed }),
      ...(request.frequency_penalty !== undefined &&
        request.frequency_penalty !== null && {
          frequencyPenalty: request.frequency_penalty,
        }),
      ...(request.presence_penalty !== undefined &&
        request.presence_penalty !== null && {
          presencePenalty: request.presence_penalty,
        }),
    },
    ...(request.stream === true && { stream: true }),
    ...(request.stream === false && { stream: false }),
  };
}

function convertToCanonicalMessage(
  msg: ChatCompletionMessageParam,
): CanonicalMessage {
  const base: CanonicalMessage = {
    role: msg.role as CanonicalMessage["role"],
    content: "",
  };

  if ("content" in msg && msg.content !== null) {
    if (typeof msg.content === "string") {
      base.content = msg.content;
    } else if (Array.isArray(msg.content)) {
      base.content = msg.content.map(convertToCanonicalPart);
    }
  }

  if ("tool_calls" in msg && msg.tool_calls) {
    base.toolCalls = msg.tool_calls
      .filter(
        (
          tc,
        ): tc is {
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        } => tc.type === "function" && "function" in tc,
      )
      .map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
  }

  if ("tool_call_id" in msg && msg.tool_call_id) {
    base.toolCallId = msg.tool_call_id;
  }

  if ("name" in msg && msg.name) {
    base.name = msg.name;
  }

  return base;
}

function convertToCanonicalPart(part: {
  type: string;
  text?: string;
  image_url?: { url: string };
}): CanonicalContentPart {
  if (part.type === "text" && part.text) {
    return { type: "text", text: part.text };
  }

  if (part.type === "image_url" && part.image_url) {
    const url = part.image_url.url;
    if (url.startsWith("data:")) {
      const [meta, data] = url.split(",");
      const mimeType = (meta.split(":")[1]?.split(";")[0] ||
        "image/png") as CanonicalImage["mimeType"];
      return {
        type: "image",
        image: { data, mimeType },
      };
    }
    // URL-based images - store as text placeholder
    return { type: "text", text: `[Image: ${url}]` };
  }

  return { type: "text", text: "" };
}

function extractTextContent(msg: ChatCompletionMessageParam): string {
  if (!("content" in msg) || msg.content === null) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

// ============ REQUEST: Canonical → OpenAI ============

export function fromCanonicalRequest(
  request: CanonicalRequest,
): ChatCompletionRequest {
  const messages: ChatCompletionMessageParam[] = request.messages.map(
    convertFromCanonicalMessage,
  );

  const result: ChatCompletionRequest = {
    model: request.model,
    messages,
  };

  if (request.config) {
    const c = request.config;
    if (c.temperature !== undefined) result.temperature = c.temperature;
    if (c.maxTokens !== undefined) result.max_tokens = c.maxTokens;
    if (c.topP !== undefined) result.top_p = c.topP;
    if (c.stopSequences && c.stopSequences.length > 0) {
      result.stop = c.stopSequences;
    }
    if (c.candidateCount !== undefined) result.n = c.candidateCount;
    if (c.seed !== undefined) result.seed = c.seed;
    if (c.frequencyPenalty !== undefined) {
      result.frequency_penalty = c.frequencyPenalty;
    }
    if (c.presencePenalty !== undefined) {
      result.presence_penalty = c.presencePenalty;
    }
  }

  if (request.stream !== undefined) {
    (result as { stream?: boolean }).stream = request.stream;
  }

  return result;
}

function convertFromCanonicalMessage(
  msg: CanonicalMessage,
): ChatCompletionMessageParam {
  const content = convertFromCanonicalContent(msg.content);

  if (msg.role === "assistant") {
    const assistantMsg = {
      role: "assistant" as const,
      content: typeof content === "string" ? content : null,
    };
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      (assistantMsg as { tool_calls?: unknown }).tool_calls = msg.toolCalls.map(
        (tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }),
      );
    }
    return assistantMsg;
  }

  if (msg.role === "tool") {
    return {
      role: "tool",
      content: typeof content === "string" ? content : "",
      tool_call_id: msg.toolCallId || "",
    };
  }

  if (msg.role === "system") {
    return {
      role: "system",
      content: typeof content === "string" ? content : "",
    };
  }

  // User message
  return { role: "user", content } as ChatCompletionMessageParam;
}

function convertFromCanonicalContent(
  content: string | CanonicalContentPart[],
):
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > {
  if (typeof content === "string") return content;

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text" as const, text: part.text || "" };
    }
    if (part.type === "image" && part.image) {
      return {
        type: "image_url" as const,
        image_url: {
          url: `data:${part.image.mimeType};base64,${part.image.data}`,
        },
      };
    }
    return { type: "text" as const, text: "" };
  });
}

// ============ RESPONSE: OpenAI → Canonical ============

export function toCanonicalResponse(
  response: ChatCompletionResponse,
  model: string,
): CanonicalResponse {
  const choice = response.choices[0];

  const message: CanonicalMessage = {
    role: "assistant",
    content: choice?.message?.content ?? "",
  };

  if (choice?.message?.tool_calls) {
    message.toolCalls = choice.message.tool_calls
      .filter(
        (
          tc,
        ): tc is {
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        } => tc.type === "function" && "function" in tc,
      )
      .map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
  }

  return {
    id: response.id,
    model: model || response.model,
    message,
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
    created: response.created,
  };
}

function mapFinishReason(
  reason: string | null | undefined,
): CanonicalResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_call";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

// ============ RESPONSE: Canonical → OpenAI ============

export function fromCanonicalResponse(
  response: CanonicalResponse,
): ChatCompletionResponse {
  const toolCalls: ChatCompletionResponse["choices"][0]["message"]["tool_calls"] =
    response.message.toolCalls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

  return {
    id: response.id || `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: response.created || Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            typeof response.message.content === "string"
              ? response.message.content
              : "",
          refusal: null,
          ...(toolCalls && { tool_calls: toolCalls }),
        },
        finish_reason: mapToOpenaiFinishReason(response.finishReason),
        logprobs: null,
      },
    ],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.inputTokens,
          completion_tokens: response.usage.outputTokens,
          total_tokens: response.usage.totalTokens,
        }
      : undefined,
  };
}

function mapToOpenaiFinishReason(
  reason: CanonicalResponse["finishReason"],
): "stop" | "length" | "tool_calls" | "content_filter" {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}
