import { openaiAdapter } from "./openai.adapter";
import { geminiAdapter } from "./gemini.adapter";
import { ollamaAdapter } from "./ollama.adapter";
import { anthropicAdapter } from "./anthropic.adapter";
import type { ProviderAdapter } from "../../types/canonical.types";

export type Provider = "openai" | "gemini" | "ollama" | "anthropic";

export const adapters: Record<Provider, ProviderAdapter<unknown, unknown>> = {
  openai: openaiAdapter as ProviderAdapter<unknown, unknown>,
  gemini: geminiAdapter as ProviderAdapter<unknown, unknown>,
  ollama: ollamaAdapter as ProviderAdapter<unknown, unknown>,
  anthropic: anthropicAdapter as ProviderAdapter<unknown, unknown>,
};

/**
 * Route conventions per provider.
 * - pathPrefix: which incoming requests this provider's API shape serves
 * - requestPath: the upstream endpoint to forward to (gemini needs the
 *   model name embedded in the path)
 */
export const PROVIDER_PATHS: Record<
  Provider,
  { pathPrefix: string; requestPath: (model: string) => string }
> = {
  openai: {
    pathPrefix: "/v1/chat/completions",
    requestPath: () => "/v1/chat/completions",
  },
  gemini: {
    pathPrefix: "/v1beta/models",
    requestPath: (model) => `/v1beta/models/${model}:generateContent`,
  },
  ollama: {
    pathPrefix: "/api/chat",
    requestPath: () => "/api/chat",
  },
  anthropic: {
    pathPrefix: "/v1/messages",
    requestPath: () => "/v1/messages",
  },
};

export { openaiAdapter, geminiAdapter, ollamaAdapter, anthropicAdapter };
