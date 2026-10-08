/**
 * API Mapping Types
 * These types define the structure for API mappings used in the LLM proxy
 */

import type { Provider } from "../transformers";

/**
 * Supported API providers (for backward compatibility)
 */
export const ApiProvider = {
  OPENAI: "openai",
  GEMINI: "gemini",
  OLLAMA: "ollama",
  ANTHROPIC: "anthropic",
} as const;

export type ApiProviderType = (typeof ApiProvider)[keyof typeof ApiProvider];

/**
 * Single API mapping configuration
 */
export interface ApiMapping {
  /** The API format of incoming requests */
  source_api: Provider;

  /** The API format to transform requests into */
  target_api: Provider;

  /** The URL path prefix to match for this mapping */
  proxy_path_prefix: string;

  /** Environment variable name containing the target API base URL */
  target_base_url_env_var: string;

  /** Environment variable name containing the target API key (null if not required) */
  target_api_key_env_var: string | null;
}

/**
 * Complete API mappings configuration
 */
export interface ApiMappingsConfig {
  /** List of API mapping configurations */
  mappings: ApiMapping[];
}
