import { describe, it, expect, vi } from "vitest";
import { attemptTargets } from "./attempt-targets";
import { createRegistry } from "../routing/registry";
import type { RoutePlan } from "../routing/plan-route";

const registry = () =>
  createRegistry([
    { name: "ollama", type: "ollama", baseUrl: "http://ollama.test" },
  ]);

describe("attemptTargets", () => {
  it("single target success records one ok hop", async () => {
    const plan: RoutePlan = {
      targets: [{ provider: "ollama", model: "llama3" }],
      reason: "default",
    };
    const attempt = vi.fn().mockResolvedValue("done");

    const result = await attemptTargets(plan, registry(), attempt, {
      requestId: "r1",
    });

    expect(result.value).toBe("done");
    expect(result.target).toEqual({ provider: "ollama", model: "llama3" });
    expect(result.entry.name).toBe("ollama");
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0]).toMatchObject({
      provider: "ollama",
      model: "llama3",
      outcome: "ok",
    });
    expect(result.hops[0]!.ms).toBeGreaterThanOrEqual(0);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("single target failure rethrows the same error", async () => {
    const plan: RoutePlan = {
      targets: [{ provider: "ollama", model: "llama3" }],
      reason: "default",
    };
    const boom = new Error("boom");
    const attempt = vi.fn().mockRejectedValue(boom);

    const err = await attemptTargets(plan, registry(), attempt, {
      requestId: "r1",
    }).catch((e) => e);

    expect(err).toBe(boom);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
