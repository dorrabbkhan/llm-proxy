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
  FinishReason,
};

// Rename to avoid conflicts
export type GeminiTool = GeminiToolType;

// Convenience type for role
export type GeminiRole = 'user' | 'model';
