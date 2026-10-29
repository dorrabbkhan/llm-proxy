import { describe, it, expect, vi } from "vitest";
import { attemptTargets, canonicalForTarget } from "./attempt-targets";
import { createRegistry } from "../routing/registry";
import type { ProviderEntry } from "../routing/registry";
import type { RoutePlan } from "../routing/plan-route";
import type { CanonicalRequest } from "../types/canonical.types";

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

describe("canonicalForTarget", () => {
  const canonical = (): CanonicalRequest => ({
    model: "decoded-model",
    messages: [{ role: "user", content: "hi" }],
  });
  const entry = (contextWindow?: number): ProviderEntry => ({
    name: "ollama",
    type: "ollama",
    baseUrl: "http://ollama.test",
    ...(contextWindow === undefined ? {} : { contextWindow }),
  });
  const target = { provider: "ollama", model: "routed-model" };

  it("canonicalForTarget leaves config absent when contextWindow is unset", () => {
    const inRequest = canonical();

    const out = canonicalForTarget(inRequest, entry(), target);

    expect("config" in out).toBe(false);
    expect(out.model).toBe("routed-model");
    expect("config" in inRequest).toBe(false);
    expect(inRequest.model).toBe("decoded-model");
  });

  it("canonicalForTarget sets contextWindow on a copied config", () => {
    const inRequest: CanonicalRequest = {
      ...canonical(),
      config: { temperature: 0.2 },
    };

    const out = canonicalForTarget(inRequest, entry(32768), target);

    expect(out.config?.contextWindow).toBe(32768);
    expect(out.config?.temperature).toBe(0.2);
    expect(out.config).not.toBe(inRequest.config);
    expect(inRequest.config).toEqual({ temperature: 0.2 });
    expect(inRequest.model).toBe("decoded-model");
  });
});
