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

  it("explicit provider/model skips rules", () => {
    const plan = planRoute(
      input({
        requestedModel: "ollama/qwen3",
        routing: {
          defaultProvider: "openai",
          aliases: {},
          rules: [
            {
              match: "*",
              to: { provider: "openai", model: "mapped" },
              fallback: [],
            },
          ],
        },
        providerNames: new Set(["ollama", "openai"]),
      }),
    );

    expect(plan).toEqual({
      targets: [{ provider: "ollama", model: "qwen3" }],
      reason: "explicit",
    });
  });

  // Review Focus 1: split on the first `/` only when the prefix is a
  // registered provider name (case-sensitive); otherwise the whole
  // string is the model.
  it("model names with colons and slashes", () => {
    const providerNames = new Set(["ollama", "openrouter"]);

    expect(
      planRoute(input({ requestedModel: "ollama/qwen3-coder:30b", providerNames })),
    ).toEqual({
      targets: [{ provider: "ollama", model: "qwen3-coder:30b" }],
      reason: "explicit",
    });
    expect(
      planRoute(
        input({ requestedModel: "openrouter/qwen/qwen3-coder", providerNames }),
      ),
    ).toEqual({
      targets: [{ provider: "openrouter", model: "qwen/qwen3-coder" }],
      reason: "explicit",
    });

    // No provider named `qwen` → not explicit, falls through to default.
    expect(
      planRoute(input({ requestedModel: "qwen/qwen3-coder", providerNames })),
    ).toEqual({
      targets: [{ provider: "ollama", model: "qwen/qwen3-coder" }],
      reason: "default",
    });

    // Provider names are case-sensitive: OLLAMA ≠ ollama.
    expect(
      planRoute(input({ requestedModel: "OLLAMA/x", providerNames })),
    ).toEqual({
      targets: [{ provider: "ollama", model: "OLLAMA/x" }],
      reason: "default",
    });

    // An empty model after the slash is not explicit.
    expect(
      planRoute(input({ requestedModel: "ollama/", providerNames })),
    ).toEqual({
      targets: [{ provider: "ollama", model: "ollama/" }],
      reason: "default",
    });
  });

  it("alias resolves exactly and case-sensitively", () => {
    const routing = {
      defaultProvider: "ollama",
      aliases: { fast: { provider: "ollama", model: "qwen2.5-coder:7b" } },
      rules: [],
    };

    expect(
      planRoute(input({ requestedModel: "fast", routing })),
    ).toEqual({
      targets: [{ provider: "ollama", model: "qwen2.5-coder:7b" }],
      reason: "alias:fast",
    });

    // `Fast` is not `fast` — falls through to the default.
    expect(
      planRoute(input({ requestedModel: "Fast", routing })),
    ).toEqual({
      targets: [{ provider: "ollama", model: "Fast" }],
      reason: "default",
    });
  });

  it("when.minInputTokens at, below and above the threshold", () => {
    const routing = {
      defaultProvider: "ollama",
      aliases: {},
      rules: [
        {
          match: "claude-*",
          when: { minInputTokens: 100 },
          to: { provider: "openrouter", model: "qwen/qwen3-coder" },
          fallback: [],
        },
        {
          match: "claude-*",
          to: { provider: "ollama", model: "qwen3-coder:30b" },
          fallback: [],
        },
      ],
    };
    const providerNames = new Set(["ollama", "openrouter"]);
    const at = (estimatedInputTokens: number) =>
      planRoute(
        input({
          requestedModel: "claude-3-opus-20240229",
          estimatedInputTokens,
          routing,
          providerNames,
        }),
      );

    // 99 < 100 → the `when` fails, the next rule takes it.
    expect(at(99)).toEqual({
      targets: [{ provider: "ollama", model: "qwen3-coder:30b" }],
      reason: "rule:1",
    });
    // The threshold itself holds (>=).
    expect(at(100).reason).toBe("rule:0");
    expect(at(101).reason).toBe("rule:0");
  });

  it("fallback list follows the matched target", () => {
    const plan = planRoute(
      input({
        requestedModel: "claude-3-opus-20240229",
        routing: {
          defaultProvider: "ollama",
          aliases: {},
          rules: [
            {
              match: "claude-*",
              to: { provider: "ollama", model: "m0" },
              fallback: [
                { provider: "openai", model: "m1" },
                { provider: "openrouter", model: "m2" },
              ],
            },
          ],
        },
        providerNames: new Set(["ollama", "openai", "openrouter"]),
      }),
    );

    expect(plan.targets).toEqual([
      { provider: "ollama", model: "m0" },
      { provider: "openai", model: "m1" },
      { provider: "openrouter", model: "m2" },
    ]);
    expect(plan.targets).toHaveLength(3);
    expect(plan.reason).toBe("rule:0");
  });

  it("aliases and default carry no fallbacks", () => {
    const routing = {
      defaultProvider: "ollama",
      aliases: { fast: { provider: "openai", model: "m1" } },
      rules: [],
    };
    const providerNames = new Set(["ollama", "openai"]);

    expect(
      planRoute(input({ requestedModel: "fast", routing, providerNames }))
        .targets,
    ).toHaveLength(1);
    expect(
      planRoute(input({ requestedModel: "gpt-4", routing, providerNames }))
        .targets,
    ).toHaveLength(1);
  });

  it("same input gives the same plan", () => {
    const in_ = input({
      requestedModel: "claude-3-opus-20240229",
      routing: {
        defaultProvider: "ollama",
        aliases: { claude: { provider: "openai", model: "m1" } },
        rules: [
          {
            match: "claude-*",
            when: { minInputTokens: 100 },
            to: { provider: "ollama", model: "m0" },
            fallback: [{ provider: "openai", model: "m1" }],
          },
        ],
      },
      providerNames: new Set(["ollama", "openai"]),
    });

    expect(planRoute(in_)).toEqual(planRoute(in_));
  });
});
