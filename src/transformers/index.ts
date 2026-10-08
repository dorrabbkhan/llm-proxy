import { ConfigurationError } from '../utils/errors';
import {
  openaiToGeminiRequest,
  geminiToOpenaiResponse,
} from './openai-to-gemini';
import {
  openaiToOllamaRequest,
  ollamaToOpenaiResponse,
} from './openai-to-ollama';
import {
  openaiToAnthropicRequest,
  anthropicToOpenaiResponse,
} from './openai-to-anthropic';

// Transform function types
export type RequestTransformFn = (request: unknown) => unknown;
export type ResponseTransformFn = (response: unknown, model: string) => unknown;

// Registry of all transformers
export const transformerRegistry = {
  request: {
    openaiToGeminiChat: openaiToGeminiRequest,
    openaiToOllamaChat: openaiToOllamaRequest,
    openaiToAnthropicChat: openaiToAnthropicRequest,
    // Identity transforms (same format)
    openaiToOpenaiChat: (req: unknown) => req,
    geminiToGeminiChat: (req: unknown) => req,
    ollamaToOllamaChat: (req: unknown) => req,
    anthropicToAnthropicChat: (req: unknown) => req,
  } as Record<string, RequestTransformFn>,

  response: {
    geminiToOpenaiChat: geminiToOpenaiResponse,
    ollamaToOpenaiChat: ollamaToOpenaiResponse,
    anthropicToOpenaiChat: anthropicToOpenaiResponse,
    // Identity transforms (same format)
    openaiToOpenaiChat: (res: unknown) => res,
    geminiToGeminiChat: (res: unknown) => res,
    ollamaToOllamaChat: (res: unknown) => res,
    anthropicToAnthropicChat: (res: unknown) => res,
  } as Record<string, ResponseTransformFn>,
};

export interface Transformers {
  requestTransform: RequestTransformFn;
  responseTransform: ResponseTransformFn;
}

export function getTransformers(
  requestTransformName: string,
  responseTransformName: string
): Transformers {
  const requestTransform = transformerRegistry.request[requestTransformName];
  const responseTransform = transformerRegistry.response[responseTransformName];

  if (!requestTransform) {
    throw new ConfigurationError(
      `Unknown request transformer: ${requestTransformName}`,
      { availableTransformers: Object.keys(transformerRegistry.request) }
    );
  }

  if (!responseTransform) {
    throw new ConfigurationError(
      `Unknown response transformer: ${responseTransformName}`,
      { availableTransformers: Object.keys(transformerRegistry.response) }
    );
  }

  return { requestTransform, responseTransform };
}

// Re-export individual transformers for direct use
export {
  openaiToGeminiRequest,
  geminiToOpenaiResponse,
  openaiToOllamaRequest,
  ollamaToOpenaiResponse,
  openaiToAnthropicRequest,
  anthropicToOpenaiResponse,
};
