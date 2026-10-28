import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseModelMap, applyModelMap } from "./model-map";
import { loadConfig, resetConfig } from "../config/env-config";
import { ConfigurationError } from "./errors";

describe("model map", () => {
  it("model map first match wins", () => {
    const rules = parseModelMap(
      "claude-*haiku*=qwen2.5-coder:7b,claude-*=qwen3-coder:30b",
    );

    expect(applyModelMap("claude-3-5-haiku-latest", rules)).toBe(
      "qwen2.5-coder:7b",
    );
    expect(applyModelMap("claude-3-opus-20240229", rules)).toBe(
      "qwen3-coder:30b",
    );
    expect(applyModelMap("claude-haiku-extra", rules)).toBe(
      "qwen2.5-coder:7b",
    );
  });

  it("no match leaves the model", () => {
    const rules = parseModelMap("claude-*=qwen3-coder:30b");

    expect(applyModelMap("gpt-4o-mini", rules)).toBe("gpt-4o-mini");
    expect(applyModelMap("qwen3-coder:30b", [])).toBe("qwen3-coder:30b");
  });

  it("exact and mid-string globs", () => {
    const rules = parseModelMap(
      "claude-3-opus-20240229=m1,*coder*=m2,x-*-z=m3",
    );

    expect(applyModelMap("claude-3-opus-20240229", rules)).toBe("m1");
    expect(applyModelMap("qwen2.5-coder:7b", rules)).toBe("m2");
    expect(applyModelMap("x-anything-here-z", rules)).toBe("m3");
    // `*` matches an empty run too — but the literals on both sides stay
    expect(applyModelMap("x--z", rules)).toBe("m3");
    expect(applyModelMap("x-z", rules)).toBe("x-z");
  });

  it("invalid MODEL_MAP entries are rejected", () => {
    for (const bad of ["claude-*", "=model", "glob=", "a=b,c", "a=b,,c=d"]) {
      expect(() => parseModelMap(bad)).toThrow(ConfigurationError);
      expect(() => parseModelMap(bad)).toThrow(/must be glob=model/);
    }
  });

  it("unset or empty MODEL_MAP yields no rules", () => {
    expect(parseModelMap(undefined)).toEqual([]);
    expect(parseModelMap("")).toEqual([]);
  });
});

describe("MODEL_MAP at startup", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    process.env = {
      ...originalEnv,
      SOURCE_API: "anthropic",
      TARGET_API: "ollama",
      OLLAMA_API_BASE_URL: "http://localhost:11434",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it("invalid MODEL_MAP fails at startup", () => {
    process.env.MODEL_MAP = "claude-*";

    expect(() => loadConfig()).toThrow(ConfigurationError);
    expect(() => loadConfig()).toThrow(
      'MODEL_MAP entry "claude-*" must be glob=model',
    );
  });

  it("valid MODEL_MAP parses into ordered rules", () => {
    process.env.MODEL_MAP = "claude-*haiku*=qwen2.5-coder:7b,claude-*=qwen3-coder:30b";

    const config = loadConfig();
    expect(config.modelMap).toEqual([
      { pattern: "claude-*haiku*", model: "qwen2.5-coder:7b" },
      { pattern: "claude-*", model: "qwen3-coder:30b" },
    ]);
  });

  it("TARGET_CONTEXT_WINDOW must be a positive integer", () => {
    process.env.TARGET_CONTEXT_WINDOW = "abc";
    expect(() => loadConfig()).toThrow(ConfigurationError);

    process.env.TARGET_CONTEXT_WINDOW = "-5";
    expect(() => loadConfig()).toThrow(ConfigurationError);

    process.env.TARGET_CONTEXT_WINDOW = "0";
    expect(() => loadConfig()).toThrow(ConfigurationError);

    process.env.TARGET_CONTEXT_WINDOW = "32768";
    expect(loadConfig().targetContextWindow).toBe(32768);
  });
});
