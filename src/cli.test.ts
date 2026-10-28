import { describe, it, expect } from "vitest";
import {
  parseCliArgs,
  presetEnv,
  overriddenKeys,
  clientInstructions,
} from "./cli";

describe("cli", () => {
  it("claude-code + ollama preset env", () => {
    const env = presetEnv(
      { preset: "claude-code", target: "ollama", model: "qwen2.5:0.5b" },
      {},
    );

    expect(env).toEqual({
      SOURCE_API: "anthropic",
      TARGET_API: "ollama",
      MODEL_MAP: "claude-*=qwen2.5:0.5b",
      TARGET_CONTEXT_WINDOW: "32768",
      UPSTREAM_TIMEOUT_MS: "600000",
    });
  });

  it("user env wins over preset", () => {
    const env = presetEnv(
      { preset: "claude-code", target: "ollama", model: "qwen2.5:0.5b" },
      {
        SOURCE_API: "openai",
        TARGET_API: "openai",
        MODEL_MAP: "claude-*=my-model",
        UPSTREAM_TIMEOUT_MS: "1234",
      },
    );

    expect(env).toEqual({ TARGET_CONTEXT_WINDOW: "32768" });
  });

  it("claude-code ollama timeout from env TARGET_API", () => {
    const env = presetEnv(
      { preset: "claude-code", model: "m" },
      { TARGET_API: "ollama" },
    );

    expect(env).toEqual({
      SOURCE_API: "anthropic",
      MODEL_MAP: "claude-*=m",
      TARGET_CONTEXT_WINDOW: "32768",
      UPSTREAM_TIMEOUT_MS: "600000",
    });
  });

  it("claude-code instructions", () => {
    expect(clientInstructions({ preset: "claude-code" }, 3000, "k")).toEqual([
      "export ANTHROPIC_BASE_URL=http://localhost:3000",
      "export ANTHROPIC_AUTH_TOKEN=k",
    ]);
    expect(clientInstructions({ preset: "claude-code" }, 3000)).toEqual([
      "export ANTHROPIC_BASE_URL=http://localhost:3000",
      "export ANTHROPIC_AUTH_TOKEN=babelgate",
    ]);
  });

  it("reports env keys that override the preset", () => {
    expect(
      overriddenKeys(
        { preset: "claude-code", target: "ollama", model: "qwen2.5:0.5b" },
        {
          SOURCE_API: "openai",
          TARGET_API: "openai",
          MODEL_MAP: "claude-*=my-model",
          UPSTREAM_TIMEOUT_MS: "1234",
        },
      ),
    ).toEqual(["SOURCE_API", "TARGET_API", "MODEL_MAP", "UPSTREAM_TIMEOUT_MS"]);
  });

  it("openai-apps instructions", () => {
    expect(
      clientInstructions({ preset: "openai-apps" }, 3000, "proxy-secret"),
    ).toEqual([
      "export OPENAI_BASE_URL=http://localhost:3000/v1",
      "export OPENAI_API_KEY=proxy-secret",
    ]);
    expect(clientInstructions({ preset: "openai-apps" }, 8080)).toEqual([
      "export OPENAI_BASE_URL=http://localhost:8080/v1",
      "export OPENAI_API_KEY=babelgate",
    ]);
  });

  it("--base-url sets the target base URL", () => {
    expect(
      presetEnv(
        { target: "openai", baseUrl: "https://openrouter.ai/api/v1" },
        {},
      ),
    ).toEqual({
      TARGET_API: "openai",
      OPENAI_API_BASE_URL: "https://openrouter.ai/api/v1",
    });
  });

  it("unknown flag throws naming it", () => {
    expect(() => parseCliArgs(["--bogus", "x"])).toThrow(/--bogus/);
    expect(() => parseCliArgs(["--preset", "nope"])).toThrow(/--preset/);
    expect(() => parseCliArgs(["--target", "nope"])).toThrow(/--target/);
    expect(() => parseCliArgs(["--port", "abc"])).toThrow(/--port/);
  });

  it("no flag accepts an API key", () => {
    expect(() => parseCliArgs(["--api-key", "x"])).toThrow(/--api-key/);
    expect(() => parseCliArgs(["--openai-api-key", "x"])).toThrow(
      /--openai-api-key/,
    );
  });
});
