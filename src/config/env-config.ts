import dotenv from "dotenv";
import type { Provider } from "../transformers";
import { parseModelMap, type ModelMapRule } from "../utils/model-map";
import {
  createRegistry,
  type ProviderRegistry,
} from "../routing/registry";
import type { RoutingConfig } from "../routing/plan-route";
import { ConfigurationError } from "../utils/errors";

dotenv.config({ quiet: true });

const VALID_PROVIDERS: Provider[] = ["openai", "gemini", "ollama", "anthropic"];

/**
 * Gateway-shaped config (spec §3.1): scalars plus the provider registry
 * and routing table the services consume. `sourceApi` is temporary —
 * the configured source format still decides the client dialect until
 * Task 2 retires it for request-path detection.
 */
export interface GatewayConfig {
  port: number;
  /** Client-facing auth key — unset means auth disabled */
  proxyApiKey?: string;
  upstreamTimeoutMs: number;
  upstreamRetries: number;
  /** Longest gap allowed between chunks mid-stream (spec §3.2) */
  upstreamStreamIdleMs: number;
  registry: ProviderRegistry;
  routing: RoutingConfig;
  /** Temporary: removed in Task 2 */
  sourceApi: Provider;
}

/**
 * v1.1's single-target fields, kept so env-config callers and tests are
 * untouched. Env-only mode is always an EnvConfig; GatewayConfig is the
 * view the services see.
 */
export interface EnvConfig extends GatewayConfig {
  targetApi: Provider;
  targetApiKey?: string;
  targetBaseUrl: string;
  /** Ordered glob=model rules applied to the canonical model (§3.5) */
  modelMap: ModelMapRule[];
  /** Minimum context window the target should allocate (Ollama num_ctx) */
  targetContextWindow?: number;
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
export function loadConfig(): EnvConfig {
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

  const modelMap = parseModelMap(process.env.MODEL_MAP);
  const targetContextWindow = parseTargetContextWindow();

  // Env-only mode (spec §3.5): one provider named after TARGET_API,
  // itself the default; MODEL_MAP entries become ordered routes to it.
  const registry = createRegistry([
    {
      name: normalizedTarget,
      type: normalizedTarget,
      baseUrl: targetBaseUrl.replace(/\/$/, ""),
      apiKey: targetApiKey,
      apiKeyEnv:
        targetApiKey !== undefined
          ? apiKeyEnvVars[normalizedTarget]
          : undefined,
      contextWindow: targetContextWindow,
    },
  ]);
  const routing: RoutingConfig = {
    defaultProvider: normalizedTarget,
    aliases: {},
    rules: modelMap.map((rule) => ({
      match: rule.pattern,
      to: { provider: normalizedTarget, model: rule.model },
      fallback: [],
    })),
  };

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
    upstreamStreamIdleMs: process.env.UPSTREAM_STREAM_IDLE_MS
      ? parseInt(process.env.UPSTREAM_STREAM_IDLE_MS, 10)
      : 300_000,
    proxyApiKey: process.env.PROXY_API_KEY || undefined,
    modelMap,
    targetContextWindow,
    registry,
    routing,
  };
}

function parseTargetContextWindow(): number | undefined {
  const raw = process.env.TARGET_CONTEXT_WINDOW;
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError(
      "TARGET_CONTEXT_WINDOW must be a positive integer",
    );
  }
  return value;
}

/**
 * Get the current configuration (lazy-loaded)
 */
let _config: EnvConfig | null = null;

export function getConfig(): GatewayConfig {
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
