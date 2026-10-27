import { randomUUID } from "crypto";
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentPart,
  CanonicalToolCall,
  CanonicalError,
  CanonicalErrorKind,
  CanonicalFinishReason,
  ProviderAdapter,
  CanonicalModelList,
  CanonicalToolChoice,
  IdGenerator,
} from "../../types/canonical.types";
import {
  kindFromStatus,
  makeCanonicalError,
} from "../../utils/canonical-error";
import { ValidationError } from "../../utils/errors";
import { createIdGenerator } from "../../utils/ids";
import { parseToolArguments } from "../../utils/tool-args";
import { logger } from "../../utils/logger";
import { toGeminiSchema } from "./gemini.schema";
import type {
  Content,
  GenerateContentRequest,
  GenerateContentResponse,
  Part,
  GeminiRole,
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiToolConfig,
  FunctionDeclaration,
  FunctionCallPart,
  FunctionResponsePart,
  ToolConfig,
} from "../../types/gemini.types";
import {
  createStreamDecoder,
  createStreamEncoder,
} from "./gemini.stream";

/**
 * Gemini FinishReason values — duplicated locally so the SDK stays a
 * type-only dependency. These are stable API constants (string enum
 * values), not implementation details.
 */
const FinishReason = {
  STOP: "STOP",
  MAX_TOKENS: "MAX_TOKENS",
  SAFETY: "SAFETY",
  RECITATION: "RECITATION",
  BLOCKLIST: "BLOCKLIST",
  PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
  SPII: "SPII",
  IMAGE_SAFETY: "IMAGE_SAFETY",
} as const;
type FinishReason = (typeof FinishReason)[keyof typeof FinishReason];

/** SDK candidate type — finishReason is a nominal enum, needs a cast site */
type GeminiCandidate = NonNullable<
  GenerateContentResponse["candidates"]
>[number];

export const geminiAdapter: ProviderAdapter<
  GenerateContentRequest,
  GenerateContentResponse
> = {
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

// ============ REQUEST: Gemini → Canonical ============

export function toCanonicalRequest(
  request: GenerateContentRequest,
): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  let systemPrompt: string | undefined;
  const ids = createIdGenerator();
  // function name → resolved call id, for matching functionResponses
  const callIds = new Map<string, string>();

  // Extract system instruction
  if (request.systemInstruction) {
    systemPrompt = extractTextFromInstruction(request.systemInstruction);
  }

  // Convert contents to messages
  for (const content of request.contents) {
    const parts = content.parts ?? [];
    const functionResponses = parts.filter(isFunctionResponsePart);
    const otherParts = parts.filter((p) => !isFunctionResponsePart(p));

    if (content.role === "model") {
      const callParts = otherParts.filter(isFunctionCallPart);
      const toolCalls = callParts.map(
        (part): CanonicalToolCall => {
          const call = part.functionCall as GeminiFunctionCall;
          const id = call.id ?? ids();
          callIds.set(call.name, id);
          return {
            id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args ?? {}),
            },
          };
        },
      );
      messages.push({
        role: "assistant",
        content: extractContentParts({
          role: content.role,
          parts: otherParts.filter((p) => !isFunctionCallPart(p)),
        }),
        ...(toolCalls.length > 0 && { toolCalls }),
      });
    } else {
      for (const part of functionResponses) {
        const res = part.functionResponse as GeminiFunctionResponse;
        const toolCallId = res.id ?? callIds.get(res.name);
        if (!toolCallId) {
          throw new ValidationError(
            `Function response "${res.name}" has no matching function call in this request`,
          );
        }
        messages.push({
          role: "tool",
          toolCallId,
          content: functionResponseContent(res),
        });
      }
      if (otherParts.length > 0) {
        messages.push({
          role: "user",
          content: extractContentParts({
            role: content.role,
            parts: otherParts,
          }),
        });
      }
    }
  }

  const result: CanonicalRequest = {
    model: "gemini-pro",
    messages,
    ...(systemPrompt && { systemPrompt }),
  };

  // Convert tool definitions
  const declarations =
    request.tools?.flatMap((tool) =>
      "functionDeclarations" in tool && tool.functionDeclarations
        ? tool.functionDeclarations
        : [],
    ) ?? [];
  if (declarations.length > 0) {
    result.tools = declarations.map((decl) => ({
      type: "function" as const,
      function: {
        name: decl.name,
        ...(decl.description !== undefined && {
          description: decl.description,
        }),
        ...(decl.parameters !== undefined && {
          parameters: decl.parameters as unknown as Record<
            string,
            unknown
          >,
        }),
      },
    }));
  }

  // Convert tool config
  const fcc = (request.toolConfig as GeminiToolConfig | undefined)
    ?.functionCallingConfig;
  if (fcc?.mode !== undefined) {
    switch (fcc.mode) {
      case "AUTO":
      case "MODE_UNSPECIFIED":
        result.toolChoice = "auto";
        break;
      case "NONE":
        result.toolChoice = "none";
        break;
      case "ANY": {
        const names = fcc.allowedFunctionNames ?? [];
        if (names.length === 0) {
          result.toolChoice = "required";
        } else if (names.length === 1) {
          result.toolChoice = {
            type: "function",
            function: { name: names[0] },
          };
        } else {
          throw new ValidationError(
            "Gemini functionCallingConfig with multiple allowedFunctionNames has no canonical equivalent",
          );
        }
        break;
      }
      default:
        throw new ValidationError(
          `Gemini functionCallingConfig mode "${fcc.mode}" is not supported`,
        );
    }
  }

  // Convert generation config
  if (request.generationConfig) {
    const gc = request.generationConfig;
    result.config = {
      ...(gc.temperature !== undefined && { temperature: gc.temperature }),
      ...(gc.maxOutputTokens !== undefined && {
        maxTokens: gc.maxOutputTokens,
      }),
      ...(gc.topP !== undefined && { topP: gc.topP }),
      ...(gc.topK !== undefined && { topK: gc.topK }),
      ...(gc.stopSequences && { stopSequences: gc.stopSequences }),
      ...(gc.candidateCount !== undefined && {
        candidateCount: gc.candidateCount,
      }),
    };
  }

  return result;
}

function extractTextFromInstruction(
  instruction: GenerateContentRequest["systemInstruction"],
): string {
  if (!instruction) return "";
  if (typeof instruction === "string") return instruction;
  if ("text" in instruction && typeof instruction.text === "string") {
    return instruction.text;
  }
  if ("parts" in instruction) {
    return (instruction as Content).parts
      .filter((p): p is { text: string } => "text" in p)
      .map((p) => p.text)
      .join("");
  }
  return "";
}

function extractContentParts(
  content: Content,
): string | CanonicalContentPart[] {
  if (!content.parts || content.parts.length === 0) {
    return "";
  }

  // If all parts are text, join them
  const allText = content.parts.every((p) => "text" in p);
  if (allText) {
    return content.parts
      .filter((p): p is { text: string } => "text" in p)
      .map((p) => p.text)
      .join("");
  }

  // Mixed content
  return content.parts.map((part): CanonicalContentPart => {
    if ("text" in part) {
      return { type: "text", text: part.text };
    }
    if ("inlineData" in part && part.inlineData) {
      return {
        type: "image",
        image: {
          data: part.inlineData.data,
          mimeType: part.inlineData
            .mimeType as CanonicalContentPart["image"] extends {
            mimeType: infer T;
          }
            ? T
            : never,
        },
      };
    }
    return { type: "text", text: "" };
  });
}

// ============ REQUEST: Canonical → Gemini ============

export function fromCanonicalRequest(
  request: CanonicalRequest,
): GenerateContentRequest {
  // toolCallId → function name, resolved from earlier assistant messages
  const callNames = new Map<string, string>();
  const contents: Content[] = [];

  for (const m of request.messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant") {
      const calls = m.toolCalls ?? [];
      let parts = convertToParts(m.content);
      for (const call of calls) {
        callNames.set(call.id, call.function.name);
      }
      if (calls.length > 0) {
        parts = parts.filter(
          (p) => !("text" in p && p.text === ""),
        );
        parts.push(...calls.map(functionCallPart));
      }
      contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      const name = m.toolCallId
        ? callNames.get(m.toolCallId)
        : undefined;
      if (!name) {
        throw new ValidationError(
          `Tool result "${m.toolCallId ?? ""}" has no matching assistant tool call`,
        );
      }
      const part: Part = {
        functionResponse: {
          name,
          response: toolResultResponse(m.content),
        },
      };
      const last = contents[contents.length - 1];
      if (
        last?.role === "user" &&
        last.parts.every(isFunctionResponsePart)
      ) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
    } else {
      contents.push({
        role: mapRoleToGemini(m.role),
        parts: convertToParts(m.content),
      });
    }
  }

  const result: GenerateContentRequest = {
    contents,
  };

  // Tool definitions; parameters filtered to Google's documented
  // schema subset (spec §3.4)
  if (request.tools?.length) {
    result.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.function.name,
          ...(tool.function.description !== undefined && {
            description: tool.function.description,
          }),
          ...(tool.function.parameters !== undefined && {
            parameters: toGeminiSchema(
              tool.function.parameters,
            ) as unknown as FunctionDeclaration["parameters"],
          }),
        })),
      },
    ];
  }

  // Tool choice → functionCallingConfig
  if (request.toolChoice !== undefined) {
    result.toolConfig = {
      functionCallingConfig: toFunctionCallingConfig(
        request.toolChoice,
      ) as ToolConfig["functionCallingConfig"],
    };
  }

  // Add system instruction
  const systemMsg = request.messages.find((m) => m.role === "system");
  if (systemMsg || request.systemPrompt) {
    const systemText =
      request.systemPrompt ||
      (typeof systemMsg?.content === "string" ? systemMsg.content : "");
    if (systemText) {
      result.systemInstruction = {
        role: "user" as GeminiRole,
        parts: [{ text: systemText }],
      };
    }
  }

  // Add generation config
  if (request.config) {
    const c = request.config;
    result.generationConfig = {
      ...(c.temperature !== undefined && { temperature: c.temperature }),
      ...(c.maxTokens !== undefined && { maxOutputTokens: c.maxTokens }),
      ...(c.topP !== undefined && { topP: c.topP }),
      ...(c.topK !== undefined && { topK: c.topK }),
      ...(c.stopSequences && { stopSequences: c.stopSequences }),
      ...(c.candidateCount !== undefined && {
        candidateCount: c.candidateCount,
      }),
    };
  }

  return result;
}

function mapRoleToGemini(role: CanonicalMessage["role"]): GeminiRole {
  return role === "assistant" ? "model" : "user";
}

function convertToParts(content: string | CanonicalContentPart[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  return content.map((part): Part => {
    if (part.type === "text") {
      return { text: part.text || "" };
    }
    if (part.type === "image" && part.image) {
      return {
        inlineData: {
          mimeType: part.image.mimeType,
          data: part.image.data,
        },
      };
    }
    return { text: "" };
  });
}

// ============ RESPONSE: Gemini → Canonical ============

export function toCanonicalResponse(
  response: GenerateContentResponse,
  model: string,
  ids: IdGenerator = createIdGenerator(),
): CanonicalResponse {
  const candidate = response.candidates?.[0];
  const content = candidate?.content;
  const parts = content?.parts ?? [];

  const text = parts
    .filter((p): p is { text: string } => "text" in p)
    .map((p) => p.text)
    .join("");
  const toolCalls = parts
    .filter(isFunctionCallPart)
    .map((part): CanonicalToolCall => {
      const call = part.functionCall as GeminiFunctionCall;
      return {
        id: call.id ?? ids(),
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        },
      };
    });

  return {
    id: `gemini-${randomUUID()}`,
    model,
    message: {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 && { toolCalls }),
    },
    finishReason:
      toolCalls.length > 0
        ? "tool_call"
        : mapFinishReason(candidate?.finishReason),
    usage: response.usageMetadata
      ? {
          inputTokens: response.usageMetadata.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        }
      : undefined,
  };
}

export function mapFinishReason(
  reason: FinishReason | string | undefined,
): CanonicalFinishReason {
  switch (reason) {
    case FinishReason.STOP:
    case "STOP":
      return "stop";
    case FinishReason.MAX_TOKENS:
    case "MAX_TOKENS":
      return "length";
    case FinishReason.SAFETY:
    case "SAFETY":
    case FinishReason.RECITATION:
    case "RECITATION":
    case FinishReason.BLOCKLIST:
    case "BLOCKLIST":
    case FinishReason.PROHIBITED_CONTENT:
    case "PROHIBITED_CONTENT":
    case FinishReason.SPII:
    case "SPII":
    case FinishReason.IMAGE_SAFETY:
    case "IMAGE_SAFETY":
      return "content_filter";
    default:
      return "stop";
  }
}

// ============ RESPONSE: Canonical → Gemini ============

export function fromCanonicalResponse(
  response: CanonicalResponse,
): GenerateContentResponse {
  const content =
    typeof response.message.content === "string"
      ? response.message.content
      : "";
  const toolCalls = response.message.toolCalls ?? [];
  const parts: Part[] =
    toolCalls.length > 0 && content === ""
      ? toolCalls.map(functionCallPart)
      : [{ text: content }, ...toolCalls.map(functionCallPart)];

  return {
    candidates: [
      {
        content: {
          role: "model",
          parts,
        },
        finishReason: mapToGeminiFinishReason(
          response.finishReason,
        ) as GeminiCandidate["finishReason"],
        index: 0,
      },
    ],
    usageMetadata: response.usage
      ? {
          promptTokenCount: response.usage.inputTokens,
          candidatesTokenCount: response.usage.outputTokens,
          totalTokenCount: response.usage.totalTokens,
        }
      : undefined,
  };
}

// ============ MODEL LIST (/v1beta/models) ============

interface GeminiModelListResponse {
  models?: { name?: string; displayName?: string }[];
}

export function toCanonicalModelList(response: unknown): CanonicalModelList {
  const res = response as GeminiModelListResponse;
  return {
    models: (res.models ?? [])
      .filter((m): m is { name: string; displayName?: string } =>
        Boolean(m.name),
      )
      .map((m) => ({
        // "models/gemini-2.0-flash" → "gemini-2.0-flash"
        id: m.name.replace(/^models\//, ""),
        displayName: m.displayName,
      })),
  };
}

export function fromCanonicalModelList(
  list: CanonicalModelList,
): GeminiModelListResponse {
  return {
    models: list.models.map((m) => ({
      name: `models/${m.id}`,
      displayName: m.displayName,
    })),
  };
}

export function mapToGeminiFinishReason(
  reason: CanonicalFinishReason,
): FinishReason {
  switch (reason) {
    case "stop":
      return FinishReason.STOP;
    case "length":
      return FinishReason.MAX_TOKENS;
    case "content_filter":
      return FinishReason.SAFETY;
    default:
      return FinishReason.STOP;
  }
}

// ============ TOOLS (spec §3.4) ============

function isFunctionCallPart(part: Part): part is FunctionCallPart {
  return "functionCall" in part && part.functionCall != null;
}

function isFunctionResponsePart(
  part: Part,
): part is FunctionResponsePart {
  return "functionResponse" in part && part.functionResponse != null;
}

/** Canonical tool call → Gemini functionCall part (id dropped on the wire). */
function functionCallPart(call: CanonicalToolCall): Part {
  const parsed = parseToolArguments(call.function.arguments);
  if (!parsed.valid) {
    logger.warn(
      "Tool call arguments are not valid JSON; sending _invalid_arguments wrapper",
    );
  }
  return {
    functionCall: { name: call.function.name, args: parsed.args },
  };
}

/** Canonical tool-result content → Gemini functionResponse.response object. */
function toolResultResponse(
  content: CanonicalMessage["content"],
): Record<string, unknown> {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("");
  const parsed = parseToolArguments(text);
  if (parsed.valid && text.trim() !== "") {
    return parsed.args;
  }
  return { content: text };
}

/** Gemini functionResponse → canonical tool-message content string. */
function functionResponseContent(res: GeminiFunctionResponse): string {
  const response = res.response;
  if (
    response !== null &&
    typeof response === "object" &&
    !Array.isArray(response)
  ) {
    const keys = Object.keys(response);
    // Unwrap the { "content": "<string>" } wrapper this adapter emits
    if (
      keys.length === 1 &&
      typeof response.content === "string"
    ) {
      return response.content;
    }
    return JSON.stringify(response);
  }
  return JSON.stringify(response ?? {});
}

function toFunctionCallingConfig(
  choice: CanonicalToolChoice,
): GeminiToolConfig["functionCallingConfig"] {
  if (choice === "auto") return { mode: "AUTO" };
  if (choice === "none") return { mode: "NONE" };
  if (choice === "required") return { mode: "ANY" };
  return {
    mode: "ANY",
    allowedFunctionNames: [choice.function.name],
  };
}

// ============ ERRORS ============

const GEMINI_ERROR_STATUS: Record<CanonicalErrorKind, string> = {
  invalid_request: "INVALID_ARGUMENT",
  authentication: "UNAUTHENTICATED",
  permission: "PERMISSION_DENIED",
  not_found: "NOT_FOUND",
  request_too_large: "RESOURCE_EXHAUSTED",
  rate_limit: "RESOURCE_EXHAUSTED",
  unsupported: "UNIMPLEMENTED",
  upstream: "INTERNAL",
  unavailable: "UNAVAILABLE",
  timeout: "DEADLINE_EXCEEDED",
  internal: "INTERNAL",
};

export function toCanonicalError(
  status: number,
  body: unknown,
): CanonicalError {
  const err = (
    body as { error?: { message?: unknown; details?: unknown } } | null
  )?.error;
  const message =
    typeof err?.message === "string" && err.message.length > 0
      ? err.message
      : `Upstream gemini returned ${status}`;
  const details = err?.details;
  const keyInvalid =
    Array.isArray(details) &&
    details.some(
      (d) =>
        typeof d === "object" &&
        d !== null &&
        (d as { reason?: unknown }).reason === "API_KEY_INVALID",
    );
  return makeCanonicalError(
    keyInvalid ? "authentication" : kindFromStatus(status),
    message,
  );
}

export function fromCanonicalError(err: CanonicalError): unknown {
  return {
    error: {
      code: err.status,
      message: err.message,
      status: GEMINI_ERROR_STATUS[err.kind],
    },
  };
}
