import { describe, it, expect } from "vitest";
import {
  authHeaders,
  createRegistry,
  type ProviderEntry,
} from "./registry";
import { ConfigurationError } from "../utils/errors";

const entry = (over: Partial<ProviderEntry>): ProviderEntry => ({
  name: "test",
  type: "ollama",
  baseUrl: "http://test.local",
  ...over,
});

describe("provider registry", () => {
  it("auth headers per type", () => {
    expect(authHeaders(entry({ type: "openai", apiKey: "k" }))).toEqual({
      Authorization: "Bearer k",
    });
    expect(authHeaders(entry({ type: "anthropic", apiKey: "k" }))).toEqual({
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
    });
    expect(authHeaders(entry({ type: "gemini", apiKey: "k" }))).toEqual({
      "x-goog-api-key": "k",
    });
    expect(authHeaders(entry({ type: "ollama", apiKey: "k" }))).toEqual({});
    expect(authHeaders(entry({ type: "openai" }))).toEqual({});
  });

  it("duplicate provider name throws", () => {
    expect(() =>
      createRegistry([entry({ name: "a" }), entry({ name: "a" })]),
    ).toThrow(ConfigurationError);
  });

  it("get unknown name throws ConfigurationError", () => {
    const registry = createRegistry([entry({ name: "a" })]);

    expect(registry.has("b")).toBe(false);
    expect(() => registry.get("b")).toThrow(ConfigurationError);
  });

  it("names keep insertion order", () => {
    const registry = createRegistry([
      entry({ name: "zeta" }),
      entry({ name: "alpha" }),
      entry({ name: "mid" }),
    ]);

    expect(registry.names()).toEqual(["zeta", "alpha", "mid"]);
  });
});
