import { describe, it, expect } from "vitest";
import { globMatch } from "./rules";

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
