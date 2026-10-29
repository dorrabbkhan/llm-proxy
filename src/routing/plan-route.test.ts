import { describe, it, expect } from "vitest";
import { planRoute, type PlanRouteInput } from "./plan-route";

const input = (over: Partial<PlanRouteInput>): PlanRouteInput => ({
  requestedModel: "gpt-4",
  estimatedInputTokens: 10,
  routing: { defaultProvider: "ollama", aliases: {}, rules: [] },
  providerNames: new Set(["ollama"]),
  ...over,
});

describe("planRoute", () => {
  it("first matching rule wins", () => {
    const plan = planRoute(
      input({
        requestedModel: "claude-3-5-haiku-latest",
        routing: {
          defaultProvider: "ollama",
          aliases: {},
          rules: [
            {
              match: "claude-*haiku*",
              to: { provider: "ollama", model: "qwen2.5-coder:7b" },
              fallback: [],
            },
            {
              match: "claude-*",
              to: { provider: "ollama", model: "qwen3-coder:30b" },
              fallback: [],
            },
          ],
        },
      }),
    );

    expect(plan.targets).toEqual([
      { provider: "ollama", model: "qwen2.5-coder:7b" },
    ]);
    expect(plan.reason).toBe("rule:0");
  });

  it("no match → default with model unchanged", () => {
    expect(planRoute(input({}))).toEqual({
      targets: [{ provider: "ollama", model: "gpt-4" }],
      reason: "default",
    });
  });

  it("rule reason is its index", () => {
    const plan = planRoute(
      input({
        requestedModel: "claude-3-opus-20240229",
        routing: {
          defaultProvider: "ollama",
          aliases: {},
          rules: [
            {
              match: "gpt-*",
              to: { provider: "ollama", model: "m1" },
              fallback: [],
            },
            {
              match: "claude-*",
              to: { provider: "ollama", model: "m2" },
              fallback: [],
            },
          ],
        },
      }),
    );

    expect(plan.reason).toBe("rule:1");
    expect(plan.targets).toEqual([{ provider: "ollama", model: "m2" }]);
  });
});
