import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import request from "supertest";
import { app } from "../../src/app";
import { resetConfig } from "../../src/config/env-config";
import {
  PROVIDER_PATHS,
  PROVIDER_ROUTES,
  type Provider,
} from "../../src/transformers";
import {
  upstreamHandlers,
  capturedRequests,
  resetCaptured,
  resetOverrides,
  MOCK_BASE_URLS,
} from "../mocks/upstreams";
import openaiFixtures from "../fixtures/openai.json";
import geminiFixtures from "../fixtures/gemini.json";
import ollamaFixtures from "../fixtures/ollama.json";
import anthropicFixtures from "../fixtures/anthropic.json";

/**
 * Registry-driven coverage: every provider pair gets a generated
 * end-to-end test through the full HTTP pipeline. Adding a provider
 * without fixtures/adapter support fails loudly here.
 */

const server = setupServer(...upstreamHandlers);

const FIXTURES: Record<
  Provider,
  { requests: Record<string, unknown>; responses: Record<string, unknown> }
> = {
  openai: openaiFixtures,
  gemini: geminiFixtures,
  ollama: ollamaFixtures,
  anthropic: anthropicFixtures,
};

// Shape assertions that prove the response came back in SOURCE format
const SOURCE_FORMAT_CHECKS: Record<Provider, (body: unknown) => void> = {
  openai: (b) => {
    const body = b as { object?: string; choices?: unknown[] };
    expect(body.object).toBe("chat.completion");
    expect(Array.isArray(body.choices)).toBe(true);
  },
  gemini: (b) => {
    const body = b as { candidates?: unknown[] };
    expect(Array.isArray(body.candidates)).toBe(true);
  },
  ollama: (b) => {
    const body = b as { message?: unknown; done?: boolean };
    expect(body.message).toBeDefined();
    expect(typeof body.done).toBe("boolean");
  },
  anthropic: (b) => {
    const body = b as { type?: string; content?: unknown[]; role?: string };
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(Array.isArray(body.content)).toBe(true);
  },
};

// Shape assertions that prove the models list came back in SOURCE format
const MODEL_LIST_CHECKS: Record<Provider, (body: unknown) => void> = {
  openai: (b) => {
    const body = b as { object?: string; data?: { id: string }[] };
    expect(body.object).toBe("list");
    expect(body.data!.length).toBeGreaterThan(0);
    expect(body.data![0]!.id).toBeTruthy();
  },
  gemini: (b) => {
    const body = b as { models?: { name: string }[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models![0]!.name).toMatch(/^models\//);
  },
  ollama: (b) => {
    const body = b as { models?: { name: string }[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models![0]!.name).toBeTruthy();
  },
  anthropic: (b) => {
    const body = b as { data?: { id: string; type?: string }[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data![0]!.type).toBe("model");
  },
};

const providers = Object.keys(PROVIDER_PATHS) as Provider[];
const pairs = providers.flatMap((source) =>
  providers.map((target) => ({ source, target })),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });

  for (const p of providers) {
    const envVar = `${p.toUpperCase()}_API_BASE_URL`;
    process.env[envVar] = MOCK_BASE_URLS[p];
    process.env[`${p.toUpperCase()}_API_KEY`] = "test-key";
  }
});

afterEach(() => {
  server.resetHandlers();
  resetCaptured();
  resetOverrides();
});

afterAll(() => {
  server.close();
});

describe("provider pair coverage", () => {
  it.each(pairs)(
    "$source → $target proxies end-to-end",
    async ({ source, target }) => {
      process.env.SOURCE_API = source;
      process.env.TARGET_API = target;
      resetConfig();

      const sourceFixture = FIXTURES[source].requests["basic"];
      expect(
        sourceFixture,
        `missing basic request fixture for ${source}`,
      ).toBeDefined();

      // Ollama's /api/chat streams NDJSON unless stream:false is sent
      // (api.md, default true) — the single-object reply this check
      // parses needs the explicit opt-out.
      const body =
        source === "ollama"
          ? { ...(sourceFixture as Record<string, unknown>), stream: false }
          : (sourceFixture as object);

      const res = await request(app)
        .post(PROVIDER_PATHS[source].pathPrefix)
        .send(body);

      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // Upstream was hit in target provider format
      expect(capturedRequests[target]).toHaveLength(1);

      // Response came back translated to source format
      SOURCE_FORMAT_CHECKS[source](res.body);
    },
  );

  it.each(pairs)(
    "$source → $target proxies GET /models end-to-end",
    async ({ source, target }) => {
      process.env.SOURCE_API = source;
      process.env.TARGET_API = target;
      resetConfig();

      const modelsRoute = PROVIDER_ROUTES[source].find(
        (r) => r.kind === "models",
      )!;
      // GET /v1/models is shared by openai and anthropic: real Anthropic
      // clients always send anthropic-version, which is how detectSource
      // tells them apart (spec §3.2).
      let req = request(app).get(modelsRoute.pathPrefix);
      if (source === "anthropic") {
        req = req.set("anthropic-version", "2023-06-01");
      }
      const res = await req;

      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // Response must be a list of models in the SOURCE provider's shape
      MODEL_LIST_CHECKS[source](res.body);
    },
  );

  it("returns 404 for GET chat paths (method mismatch)", async () => {
    process.env.SOURCE_API = "openai";
    process.env.TARGET_API = "ollama";
    resetConfig();

    const res = await request(app).get("/v1/chat/completions");
    expect(res.status).toBe(404);
  });
});
