import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { setupServer } from "msw/node";
import request from "supertest";
import { app } from "../../src/app";
import { resetConfig } from "../../src/config/env-config";
import {
  upstreamHandlers,
  capturedRequests,
  capturedHeaders,
  responseOverrides,
  resetCaptured,
  resetOverrides,
  MOCK_BASE_URLS,
} from "../mocks/upstreams";
import openaiFixtures from "../fixtures/openai.json";
import ollamaFixtures from "../fixtures/ollama.json";
import geminiFixtures from "../fixtures/gemini.json";
import anthropicFixtures from "../fixtures/anthropic.json";

const server = setupServer(...upstreamHandlers);

beforeAll(() => {
  // 'bypass' so supertest's localhost requests pass through unmocked;
  // only the *.mock upstream hosts are handled.
  server.listen({ onUnhandledRequest: "bypass" });

  // Point all upstream env vars at mock hosts
  process.env.GEMINI_API_BASE_URL = MOCK_BASE_URLS.gemini;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OLLAMA_API_BASE_URL = MOCK_BASE_URLS.ollama;
  process.env.OPENAI_API_BASE_URL = MOCK_BASE_URLS.openai;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.ANTHROPIC_API_BASE_URL = MOCK_BASE_URLS.anthropic;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});

afterEach(() => {
  server.resetHandlers();
  resetCaptured();
  resetOverrides();
});

afterAll(() => {
  server.close();
});

describe("Proxy integration: OpenAI → Ollama", () => {
  const openaiRequest = openaiFixtures.requests.basic;

  beforeEach(() => {
    process.env.SOURCE_API = "openai";
    process.env.TARGET_API = "ollama";
    resetConfig();
  });

  it("transforms request, forwards, transforms response back", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .send(openaiRequest)
      .expect(200);

    // Upstream received Ollama-format request
    expect(capturedRequests.ollama).toHaveLength(1);
    const upstreamBody = capturedRequests.ollama[0] as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(upstreamBody.model).toBe("gpt-4");
    expect(upstreamBody.messages[0].role).toBe("user");
    expect(upstreamBody.messages[0].content).toBe("Hello");

    // Client got back OpenAI-format response
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.choices).toHaveLength(1);
    expect(res.body.choices[0].message.role).toBe("assistant");
    expect(res.body.choices[0].message.content).toBe(
      "Hello! How can I help you?",
    );
    expect(res.body.choices[0].finish_reason).toBe("stop");
    expect(res.body.usage.prompt_tokens).toBe(10);
    expect(res.body.usage.completion_tokens).toBe(8);
  });

  it("transforms generation params into ollama options", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.params)
      .expect(200);

    const upstreamBody = capturedRequests.ollama[0] as {
      options?: { temperature?: number; num_predict?: number; top_p?: number };
    };
    expect(upstreamBody.options?.temperature).toBe(0.7);
    expect(upstreamBody.options?.num_predict).toBe(150);
    expect(upstreamBody.options?.top_p).toBe(0.9);
  });
});

describe("Proxy integration: OpenAI → Gemini", () => {
  beforeEach(() => {
    process.env.SOURCE_API = "openai";
    process.env.TARGET_API = "gemini";
    resetConfig();
  });

  it("transforms request to contents/parts and maps response", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic)
      .expect(200);

    expect(capturedRequests.gemini).toHaveLength(1);
    const upstreamBody = capturedRequests.gemini[0] as {
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(upstreamBody.contents).toHaveLength(1);
    expect(upstreamBody.contents[0].role).toBe("user");
    expect(upstreamBody.contents[0].parts[0].text).toBe("Hello");
  });

  it("sends x-goog-api-key header", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic)
      .expect(200);

    const headers = capturedHeaders.gemini[0];
    expect(headers.get("x-goog-api-key")).toBe("test-gemini-key");
  });

  it("system message becomes systemInstruction", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.system)
      .expect(200);

    const upstreamBody = capturedRequests.gemini[0] as {
      systemInstruction?: { parts: { text: string }[] };
      contents: unknown[];
    };
    expect(upstreamBody.systemInstruction?.parts[0].text).toBe(
      "You are a helpful assistant",
    );
    // system message filtered from contents
    expect(upstreamBody.contents).toHaveLength(1);
  });
});

describe("Proxy integration: OpenAI → Anthropic", () => {
  beforeEach(() => {
    process.env.SOURCE_API = "openai";
    process.env.TARGET_API = "anthropic";
    resetConfig();
  });

  it("transforms request with max_tokens default and maps response", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic)
      .expect(200);

    expect(capturedRequests.anthropic).toHaveLength(1);
    const upstreamBody = capturedRequests.anthropic[0] as {
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(upstreamBody.max_tokens).toBeGreaterThan(0);
    expect(upstreamBody.messages[0].role).toBe("user");

    // Response mapped back to OpenAI format
    expect(res.body.choices[0].message.content).toBe(
      "Hello! How can I help you?",
    );
    expect(res.body.choices[0].finish_reason).toBe("stop");
  });

  it("sends x-api-key and anthropic-version headers", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic)
      .expect(200);

    const headers = capturedHeaders.anthropic[0];
    expect(headers.get("x-api-key")).toBe("test-anthropic-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("system message becomes top-level system param", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.system)
      .expect(200);

    const upstreamBody = capturedRequests.anthropic[0] as {
      system?: string;
      messages: { role: string }[];
    };
    expect(upstreamBody.system).toBe("You are a helpful assistant");
    expect(
      upstreamBody.messages.find((m) => m.role === "system"),
    ).toBeUndefined();
  });
});

describe("Proxy integration: Ollama → OpenAI", () => {
  beforeEach(() => {
    process.env.SOURCE_API = "ollama";
    process.env.TARGET_API = "openai";
    resetConfig();
  });

  it("transforms ollama request and returns ollama response", async () => {
    const res = await request(app)
      .post("/api/chat")
      .send(ollamaFixtures.requests.basic)
      .expect(200);

    // Upstream got OpenAI format
    expect(capturedRequests.openai).toHaveLength(1);
    const upstreamBody = capturedRequests.openai[0] as {
      messages: { role: string; content: string }[];
    };
    expect(upstreamBody.messages[0].role).toBe("user");
    expect(upstreamBody.messages[0].content).toBe("Hello");

    // Client got Ollama-format response
    expect(res.body.model).toBeDefined();
    expect(res.body.message.role).toBe("assistant");
    expect(res.body.done).toBe(true);
  });
});

describe("Proxy integration: Anthropic → OpenAI", () => {
  beforeEach(() => {
    process.env.SOURCE_API = "anthropic";
    process.env.TARGET_API = "openai";
    resetConfig();
  });

  it("transforms anthropic request and returns anthropic response", async () => {
    const res = await request(app)
      .post("/v1/messages")
      .send(anthropicFixtures.requests.basic)
      .expect(200);

    expect(capturedRequests.openai).toHaveLength(1);
    const upstreamBody = capturedRequests.openai[0] as {
      messages: { role: string; content: string }[];
    };
    expect(upstreamBody.messages[0].role).toBe("user");

    expect(res.body.type).toBe("message");
    expect(res.body.role).toBe("assistant");
    expect(res.body.content[0].type).toBe("text");
    expect(res.body.stop_reason).toBe("end_turn");
  });
});

describe("Error handling", () => {
  beforeEach(() => {
    process.env.SOURCE_API = "openai";
    process.env.TARGET_API = "ollama";
    resetConfig();
  });

  it("returns 502 when upstream fails", async () => {
    responseOverrides.ollama = {
      status: 500,
      body: { error: "upstream exploded" },
    };

    const res = await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_ERROR");
    expect(res.body.error.message).toContain("500");
  });

  it("returns 502 for upstream 401", async () => {
    process.env.TARGET_API = "gemini";
    resetConfig();
    responseOverrides.gemini = {
      status: 401,
      body: { error: "invalid key" },
    };

    const res = await request(app)
      .post("/v1/chat/completions")
      .send(openaiFixtures.requests.basic);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("returns 404 for unmapped paths", async () => {
    const res = await request(app).post("/unmapped/path").send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("health endpoint still works", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
