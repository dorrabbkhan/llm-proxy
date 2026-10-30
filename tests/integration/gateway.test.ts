import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
import request from "supertest";
import { app } from "../../src/app";
import { resetConfig } from "../../src/config/env-config";
import { adapters } from "../../src/transformers";
import { makeCanonicalError } from "../../src/utils/canonical-error";
import {
  upstreamHandlers,
  capturedRequests,
  resetCaptured,
  resetOverrides,
  resetStreamCase,
  MOCK_BASE_URLS,
} from "../mocks/upstreams";
import openaiFixtures from "../fixtures/openai.json";
import geminiFixtures from "../fixtures/gemini.json";
import ollamaFixtures from "../fixtures/ollama.json";
import anthropicFixtures from "../fixtures/anthropic.json";

/**
 * One port, every client format (spec §3.2, §3.8): env-only mode with a
 * single ollama target and no SOURCE_API — the request path alone
 * decides the client dialect, including error replies.
 */

const server = setupServer(...upstreamHandlers);

const providers = ["openai", "gemini", "ollama", "anthropic"] as const;

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
  for (const p of providers) {
    process.env[`${p.toUpperCase()}_API_BASE_URL`] = MOCK_BASE_URLS[p];
    process.env[`${p.toUpperCase()}_API_KEY`] = "test-key";
  }
});

beforeEach(() => {
  process.env.UPSTREAM_RETRIES = "0";
  delete process.env.SOURCE_API;
  process.env.TARGET_API = "ollama";
  resetConfig();
});

afterEach(() => {
  server.resetHandlers();
  resetCaptured();
  resetOverrides();
  resetStreamCase();
  delete process.env.UPSTREAM_RETRIES;
  resetConfig();
});

afterAll(() => {
  server.close();
});

describe("gateway: every format on one port (spec §3.2)", () => {
  it("OpenAI, Anthropic, Gemini and Ollama chat requests all proxy to the ollama target", async () => {
    const openai = await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic as object);
    expect(openai.status, JSON.stringify(openai.body)).toBe(200);
    expect(openai.body.object).toBe("chat.completion");

    const anthropic = await request(app)
      .post("/v1/messages")
      .send(anthropicFixtures.requests.basic as object);
    expect(anthropic.status, JSON.stringify(anthropic.body)).toBe(200);
    expect(anthropic.body.type).toBe("message");
    expect(anthropic.body.role).toBe("assistant");

    const gemini = await request(app)
      .post("/v1beta/models/llama3:generateContent")
      .send(geminiFixtures.requests.basic as object);
    expect(gemini.status, JSON.stringify(gemini.body)).toBe(200);
    expect(Array.isArray(gemini.body.candidates)).toBe(true);

    // Ollama's /api/chat streams NDJSON unless stream:false is sent.
    const ollama = await request(app)
      .post("/api/chat")
      .send({ ...ollamaFixtures.requests.basic, stream: false } as object);
    expect(ollama.status, JSON.stringify(ollama.body)).toBe(200);
    expect(ollama.body.message).toBeDefined();
    expect(ollama.body.done).toBe(true);

    // Every request reached the same ollama upstream in its dialect.
    expect(capturedRequests.ollama).toHaveLength(4);
    for (const body of capturedRequests.ollama) {
      expect((body as { messages?: unknown[] }).messages).toBeDefined();
    }
    expect(capturedRequests.openai).toHaveLength(0);
    expect(capturedRequests.anthropic).toHaveLength(0);
    expect(capturedRequests.gemini).toHaveLength(0);
  });

  it("auth errors render in the detected dialect", async () => {
    // PROXY_API_KEY is read when the app module is built — fresh module
    // graph per errors.test.ts's authedApp.
    vi.stubEnv("PROXY_API_KEY", "client-key");
    vi.resetModules();
    const { app: authed } = await import("../../src/app");
    const { resetConfig: freshReset } = await import(
      "../../src/config/env-config"
    );
    freshReset();
    try {
      const res = await request(authed)
        .post("/v1/messages")
        .send(anthropicFixtures.requests.basic as object);

      expect(res.status, JSON.stringify(res.body)).toBe(401);
      expect(res.body).toEqual(
        adapters.anthropic.fromCanonicalError(
          makeCanonicalError(
            "authentication",
            "Invalid or missing API key",
          ),
        ),
      );
      expect(capturedRequests.ollama).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
