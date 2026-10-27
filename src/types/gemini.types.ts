import type {
  Content,
  Part,
  TextPart,
  InlineDataPart,
  FunctionCallPart,
  FunctionResponsePart,
  GenerateContentRequest,
  GenerateContentResult,
  GenerateContentResponse,
  GenerateContentCandidate,
  GenerationConfig,
  SafetySetting,
  HarmCategory,
  HarmBlockThreshold,
  UsageMetadata,
  FunctionDeclaration,
  Tool as GeminiToolType,
  ToolConfig,
  FinishReason,
} from '@google/generative-ai';

// Re-export all types
export type {
  Content,
  Part,
  TextPart,
  InlineDataPart,
  FunctionCallPart,
  FunctionResponsePart,
  GenerateContentRequest,
  GenerateContentResult,
  GenerateContentResponse,
  GenerateContentCandidate,
  GenerationConfig,
  SafetySetting,
  HarmCategory,
  HarmBlockThreshold,
  UsageMetadata,
  FunctionDeclaration,
  ToolConfig,
  FinishReason,
};

// Rename to avoid conflicts
export type GeminiTool = GeminiToolType;

// Convenience type for role
export type GeminiRole = 'user' | 'model';

/**
 * REST wire shapes the SDK types don't cover: `functionCall.id` and
 * `functionResponse.id` are optional in the API
 * (https://ai.google.dev/api/generate-content#FunctionCall) but absent
 * from the SDK's `FunctionCall`/`FunctionResponse` types.
 */
export interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

/** toolConfig as sent on the wire; `mode` includes values newer than the SDK enum (e.g. VALIDATED). */
export interface GeminiToolConfig {
  functionCallingConfig?: {
    mode?: string;
    allowedFunctionNames?: string[];
  };
}
