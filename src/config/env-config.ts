import dotenv from "dotenv";
import { ApiProvider } from "../types/api-mapping";

dotenv.config();

export interface Config {
  sourceApi: ApiProvider;
  targetApi: ApiProvider;
  port?: number;
  targetApiKey?: string;
}

/**
 * Loads configuration from environment variables
 * @returns Configuration object with environment variables
 */
export function loadConfig(): Config {
  if (!process.env.SOURCE_API || !process.env.TARGET_API) {
    throw new Error(
      "SOURCE_API and TARGET_API environment variables are required"
    );
  }

  if (
    !Object.values(ApiProvider).includes(process.env.SOURCE_API as ApiProvider)
  ) {
    throw new Error(
      "SOURCE_API environment variable must be one of: " +
        Object.values(ApiProvider).join(", ")
    );
  }

  if (
    !Object.values(ApiProvider).includes(process.env.TARGET_API as ApiProvider)
  ) {
    throw new Error(
      "TARGET_API environment variable must be one of: " +
        Object.values(ApiProvider).join(", ")
    );
  }

  let targetApiKey: string | undefined;
  switch (process.env.TARGET_API) {
    case "GEMINI":
      targetApiKey = process.env.GEMINI_API_KEY;
      break;
    case "OLLAMA":
      targetApiKey = process.env.OLLAMA_API_KEY;
      break;
    case "QWEN":
      targetApiKey = process.env.QWEN_API_KEY;
      break;
    case "OPENAI":
      targetApiKey = process.env.OPENAI_API_KEY;
      break;
    default:
      targetApiKey = undefined;
      break;
  }

  if (!targetApiKey && process.env.TARGET_API !== "OLLAMA") {
    throw new Error(
      "TARGET_API_KEY environment variable is required for target API " +
        process.env.TARGET_API
    );
  }

  const envConfig: Config = {
    sourceApi: process.env.SOURCE_API as ApiProvider,
    targetApi: process.env.TARGET_API as ApiProvider,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    targetApiKey: targetApiKey,
  };

  return envConfig;
}

/**
 * Get the current configuration
 * @returns The current configuration
 */
export const getConfig = (): Config => {
  return loadConfig();
};

// Export a singleton instance of the configuration
export const config = loadConfig();
