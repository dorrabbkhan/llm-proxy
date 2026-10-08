import dotenv from "dotenv";
import type { Provider } from "../transformers";

dotenv.config();

const VALID_PROVIDERS: Provider[] = ["openai", "gemini", "ollama", "anthropic"];

export interface Config {
  sourceApi: Provider;
  targetApi: Provider;
  port: number;
  targetApiKey?: string;
  targetBaseUrl: string;
  upstreamTimeoutMs: number;
  upstreamRetries: number;
}

function isValidProvider(value: string): value is Provider {
  return VALID_PROVIDERS.includes(value.toLowerCase() as Provider);
}

function normalizeProvider(value: string): Provider {
  return value.toLowerCase() as Provider;
}

/**
 * Loads configuration from environment variables
 */
export function loadConfig(): Config {
  if (!process.env.SOURCE_API || !process.env.TARGET_API) {
    throw new Error(
      "SOURCE_API and TARGET_API environment variables are required",
    );
  }

  const sourceApi = process.env.SOURCE_API;
  const targetApi = process.env.TARGET_API;

  if (!isValidProvider(sourceApi)) {
    throw new Error(`SOURCE_API must be one of: ${VALID_PROVIDERS.join(", ")}`);
  }

  if (!isValidProvider(targetApi)) {
    throw new Error(`TARGET_API must be one of: ${VALID_PROVIDERS.join(", ")}`);
  }

  const normalizedTarget = normalizeProvider(targetApi);

  // Get API key based on target
  const apiKeyEnvVars: Record<Provider, string> = {
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    ollama: "OLLAMA_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
  };

  const targetApiKey = process.env[apiKeyEnvVars[normalizedTarget]];

  // Ollama doesn't require an API key
  if (!targetApiKey && normalizedTarget !== "ollama") {
    throw new Error(
      `${apiKeyEnvVars[normalizedTarget]} environment variable is required for target API ${targetApi}`,
    );
  }

  // Upstream base URL follows the {PROVIDER}_API_BASE_URL convention
  const baseUrlEnvVar = `${normalizedTarget.toUpperCase()}_API_BASE_URL`;
  const targetBaseUrl = process.env[baseUrlEnvVar];
  if (!targetBaseUrl) {
    throw new Error(
      `${baseUrlEnvVar} environment variable is required for target API ${targetApi}`,
    );
  }

  return {
    sourceApi: normalizeProvider(sourceApi),
    targetApi: normalizedTarget,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    targetApiKey,
    targetBaseUrl: targetBaseUrl.replace(/\/$/, ""),
    upstreamTimeoutMs: process.env.UPSTREAM_TIMEOUT_MS
      ? parseInt(process.env.UPSTREAM_TIMEOUT_MS, 10)
      : 30_000,
    upstreamRetries: process.env.UPSTREAM_RETRIES
      ? parseInt(process.env.UPSTREAM_RETRIES, 10)
      : 1,
  };
}

/**
 * Get the current configuration (lazy-loaded)
 */
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Reset config (for testing)
 */
export function resetConfig(): void {
  _config = null;
}
