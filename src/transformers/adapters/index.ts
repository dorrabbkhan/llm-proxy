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

export type RouteKind = "chat" | "models";

export interface ProviderRoute {
  /** Which canonical flow this route takes */
  kind: RouteKind;
  /** HTTP method on the incoming request */
  method: "GET" | "POST";
  /** Incoming request path prefix */
  pathPrefix: string;
  /** Upstream endpoint path (model only used by gemini chat) */
  requestPath: (model?: string) => string;
}

/**
 * Route conventions per provider. Each provider exposes routes for every
 * endpoint kind it supports — matched by method + pathPrefix.
 */
export const PROVIDER_ROUTES: Record<Provider, ProviderRoute[]> = {
  openai: [
    {
      kind: "chat",
      method: "POST",
      pathPrefix: "/v1/chat/completions",
      requestPath: () => "/v1/chat/completions",
    },
    {
      kind: "models",
      method: "GET",
      pathPrefix: "/v1/models",
      requestPath: () => "/v1/models",
    },
  ],
  gemini: [
    {
      kind: "chat",
      method: "POST",
      pathPrefix: "/v1beta/models",
      requestPath: (model) => `/v1beta/models/${model}:generateContent`,
    },
    {
      kind: "models",
      method: "GET",
      pathPrefix: "/v1beta/models",
      requestPath: () => "/v1beta/models",
    },
  ],
  ollama: [
    {
      kind: "chat",
      method: "POST",
      pathPrefix: "/api/chat",
      requestPath: () => "/api/chat",
    },
    {
      kind: "models",
      method: "GET",
      pathPrefix: "/api/tags",
      requestPath: () => "/api/tags",
    },
  ],
  anthropic: [
    {
      kind: "chat",
      method: "POST",
      pathPrefix: "/v1/messages",
      requestPath: () => "/v1/messages",
    },
    {
      kind: "models",
      method: "GET",
      pathPrefix: "/v1/models",
      requestPath: () => "/v1/models",
    },
  ],
};

/**
 * Back-compat view of the chat routes — chat endpoint per provider.
 * Prefer PROVIDER_ROUTES for new code.
 */
export const PROVIDER_PATHS: Record<
  Provider,
  { pathPrefix: string; requestPath: (model: string) => string }
> = Object.fromEntries(
  (Object.keys(PROVIDER_ROUTES) as Provider[]).map((provider) => {
    const chat = PROVIDER_ROUTES[provider].find((r) => r.kind === "chat")!;
    return [
      provider,
      { pathPrefix: chat.pathPrefix, requestPath: chat.requestPath },
    ];
  }),
) as Record<
  Provider,
  { pathPrefix: string; requestPath: (model: string) => string }
>;

export { openaiAdapter, geminiAdapter, ollamaAdapter, anthropicAdapter };
