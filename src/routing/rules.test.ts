import { describe, it, expect } from "vitest";
import { globMatch, parseTarget } from "./rules";

/**
 * The glob cases of utils/model-map.test.ts run against the moved
 * globMatch. model-map.test.ts stays untouched; `*` matches any run of
 * characters, everything else is literal.
 */
describe("globMatch", () => {
  it("model-map first-match patterns", () => {
    expect(globMatch("claude-*haiku*", "claude-3-5-haiku-latest")).toBe(
      true,
    );
    expect(globMatch("claude-*haiku*", "claude-3-opus-20240229")).toBe(
      false,
    );
    expect(globMatch("claude-*", "claude-3-opus-20240229")).toBe(true);
    expect(globMatch("claude-*haiku*", "claude-haiku-extra")).toBe(true);
  });

  it("no match leaves the model", () => {
    expect(globMatch("claude-*", "gpt-4o-mini")).toBe(false);
    expect(globMatch("claude-*", "qwen3-coder:30b")).toBe(false);
  });

  it("exact and mid-string globs", () => {
    expect(
      globMatch("claude-3-opus-20240229", "claude-3-opus-20240229"),
    ).toBe(true);
    expect(globMatch("*coder*", "qwen2.5-coder:7b")).toBe(true);
    expect(globMatch("x-*-z", "x-anything-here-z")).toBe(true);
    // `*` matches an empty run too — but the literals on both sides stay
    expect(globMatch("x-*-z", "x--z")).toBe(true);
    expect(globMatch("x-*-z", "x-z")).toBe(false);
  });
});

/**
 * `provider/model` targets (spec §3.3): the text before the first `/`
 * must be a registered provider name and the rest non-empty. The split
 * is on the first `/` only — model names may contain `/` and `:`.
 */
describe("parseTarget", () => {
  const names = new Set(["ollama", "openrouter"]);

  it("splits on the first slash when the prefix is a registered provider", () => {
    expect(parseTarget("ollama/qwen3-coder:30b", names)).toEqual({
      provider: "ollama",
      model: "qwen3-coder:30b",
    });
    expect(parseTarget("openrouter/qwen/qwen3-coder", names)).toEqual({
      provider: "openrouter",
      model: "qwen/qwen3-coder",
    });
  });

  it("unregistered prefix is not a target", () => {
    expect(parseTarget("qwen/qwen3-coder", names)).toBeUndefined();
  });

  it("provider names are case-sensitive", () => {
    expect(parseTarget("OLLAMA/x", names)).toBeUndefined();
  });

  it("empty model after the slash is not a target", () => {
    expect(parseTarget("ollama/", names)).toBeUndefined();
  });

  it("no slash is not a target", () => {
    expect(parseTarget("gpt-4", names)).toBeUndefined();
    expect(parseTarget("", names)).toBeUndefined();
  });
});
