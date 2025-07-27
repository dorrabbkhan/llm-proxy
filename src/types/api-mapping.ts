/**
 * API Mapping Types
 * These types define the structure for API mappings used in the LLM proxy
 */

/**
 * Supported API providers
 */
export type ApiProvider = "OPENAI" | "GEMINI" | "OLLAMA" | "QWEN";

/**
 * Single API mapping configuration
 */
export interface ApiMapping {
  /**
   * The API format of incoming requests
   */
  source_api: ApiProvider;

  /**
   * The API format to transform requests into
   */
  target_api: ApiProvider;

  /**
   * The URL path prefix to match for this mapping
   */
  proxy_path_prefix: string;

  /**
   * Environment variable name containing the target API base URL
   */
  target_base_url_env_var: string;

  /**
   * Environment variable name containing the target API key (null if not required)
   */
  target_api_key_env_var: string | null;

  /**
   * Function name to transform request from source to target format
   */
  request_transform: string;

  /**
   * Function name to transform response from target back to source format
   */
  response_transform: string;
}

/**
 * Complete API mappings configuration
 */
export interface ApiMappingsConfig {
  /**
   * List of API mapping configurations
   */
  mappings: ApiMapping[];
}
