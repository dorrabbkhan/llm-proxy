import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./env-config";
import { ApiProvider } from "../types/api-mapping";

type ProcessEnvKeys = keyof typeof process.env;

describe("Environment Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  const unsetEnv = (key: ProcessEnvKeys) => {
    if (key in process.env) {
      delete process.env[key];
    }
  };

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw error when required environment variables are not set", () => {
    unsetEnv("SOURCE_API");
    unsetEnv("TARGET_API");
    unsetEnv("PORT");

    expect(() => loadConfig()).toThrow(
      "SOURCE_API and TARGET_API environment variables are required"
    );
  });

  it("should throw error when SOURCE_API is not a valid API provider", () => {
    process.env.SOURCE_API = "INVALID_API" as any;
    process.env.TARGET_API = "OPENAI" as ApiProvider;
    process.env.OPENAI_API_KEY = "test-openai-key";

    expect(() => loadConfig()).toThrow(
      "SOURCE_API environment variable must be one of: "
    );
  });

  it("should throw error when TARGET_API is not a valid API provider", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "INVALID_API" as any;
    process.env.OPENAI_API_KEY = "test-openai-key";

    expect(() => loadConfig()).toThrow(
      "TARGET_API environment variable must be one of: "
    );
  });

  it("should throw error when API key is not set for non-OLLAMA target", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "GEMINI" as ApiProvider;
    unsetEnv("GEMINI_API_KEY");
    process.env.PORT = "4000";

    expect(() => loadConfig()).toThrow(
      "TARGET_API_KEY environment variable is required for target API GEMINI"
    );
  });

  it("should load values from environment variables when properly set for OPENAI", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "OPENAI" as ApiProvider;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.PORT = "4000";

    const config = loadConfig();

    expect(config.sourceApi).toBe("OPENAI");
    expect(config.targetApi).toBe("OPENAI");
    expect(config.port).toBe(4000);
    expect(config.targetApiKey).toBe("test-openai-key");
  });

  it("should load values from environment variables when properly set for GEMINI", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "GEMINI" as ApiProvider;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.PORT = "4000";

    const config = loadConfig();

    expect(config.sourceApi).toBe("OPENAI");
    expect(config.targetApi).toBe("GEMINI");
    expect(config.port).toBe(4000);
    expect(config.targetApiKey).toBe("test-gemini-key");
  });

  it("should load values from environment variables when properly set for QWEN", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "QWEN" as ApiProvider;
    process.env.QWEN_API_KEY = "test-qwen-key";
    process.env.PORT = "4000";

    const config = loadConfig();

    expect(config.sourceApi).toBe("OPENAI");
    expect(config.targetApi).toBe("QWEN");
    expect(config.port).toBe(4000);
    expect(config.targetApiKey).toBe("test-qwen-key");
  });

  it("should not require API key for OLLAMA target", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "OLLAMA" as ApiProvider;
    unsetEnv("OLLAMA_API_KEY");
    process.env.PORT = "4000";

    const config = loadConfig();

    expect(config.sourceApi).toBe("OPENAI");
    expect(config.targetApi).toBe("OLLAMA");
    expect(config.port).toBe(4000);
    expect(config.targetApiKey).toBeUndefined();
  });

  it("should use default port when PORT is not set", () => {
    process.env.SOURCE_API = "OPENAI" as ApiProvider;
    process.env.TARGET_API = "OLLAMA" as ApiProvider;
    unsetEnv("PORT");

    const config = loadConfig();

    expect(config.sourceApi).toBe("OPENAI");
    expect(config.targetApi).toBe("OLLAMA");
    expect(config.port).toBe(3000);
  });
});
