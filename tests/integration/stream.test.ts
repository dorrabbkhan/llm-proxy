import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import request from "supertest";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../../src/app";
import { resetConfig } from "../../src/config/env-config";
import { adapters, type Provider } from "../../src/transformers";
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
import anthropicFixtures from "../fixtures/anthropic.json";
import ollamaFixtures from "../fixtures/ollama.json";

/**
 * End-to-end streaming (spec §3.2): SSE in the client's own dialect,
 * pre-headers upstream failures rendered as normal JSON errors, and
 * mid-stream failures surfaced as in-stream error events.
 */
const server = setupServer(...upstreamHandlers);

const providers: Provider[] = ["openai", "gemini", "ollama", "anthropic"];

function setPair(source: Provider, target: Provider): void {
  process.env.SOURCE_API = source;
  process.env.TARGET_API = target;
  resetConfig();
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
  for (const p of providers) {
    process.env[`${p.toUpperCase()}_API_BASE_URL`] = MOCK_BASE_URLS[p];
    process.env[`${p.toUpperCase()}_API_KEY`] = "test-key";
  }
});

beforeEach(() => {
  process.env.UPSTREAM_RETRIES = "0";
  setPair("openai", "openai");
});

afterEach(() => {
  server.resetHandlers();
  resetCaptured();
  resetOverrides();
  resetStreamCase();
  delete process.env.UPSTREAM_RETRIES;
  delete process.env.UPSTREAM_STREAM_IDLE_MS;
  delete process.env.UPSTREAM_TIMEOUT_MS;
});

afterAll(() => {
  server.close();
});

const STREAM_BODY = {
  ...(openaiFixtures.requests.basic as Record<string, unknown>),
  stream: true,
};

/** supertest parses SSE as an opaque body — collect it as text. */
function postStream(path: string, body: unknown): request.Test {
  return request(app)
    .post(path)
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => cb(null, text));
    });
}

describe("streaming (spec §3.2)", () => {
  it("openai → openai stream:true streams SSE", async () => {
    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("data: {");
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);

    // The upstream request asked for a stream with usage (spec §3.2).
    expect(capturedRequests.openai[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("anthropic → openai stream:true streams SSE", async () => {
    setPair("anthropic", "openai");

    const res = await postStream("/v1/messages", {
      ...(anthropicFixtures.requests.basic as Record<string, unknown>),
      stream: true,
    });

    // Streams in the source's format — Anthropic event-typed SSE.
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_delta");
    expect(body.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(
      true,
    );

    expect(capturedRequests.openai[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("openai → anthropic stream:true streams SSE", async () => {
    setPair("openai", "anthropic");

    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    // Streams in the source's format — OpenAI SSE chunks plus [DONE].
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("data: {");
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);

    // The upstream request asked for a stream (spec §3.2).
    expect(capturedRequests.anthropic[0]).toMatchObject({ stream: true });
  });

  it("anthropic → anthropic stream:true streams SSE", async () => {
    setPair("anthropic", "anthropic");

    const res = await postStream("/v1/messages", {
      ...(anthropicFixtures.requests.basic as Record<string, unknown>),
      stream: true,
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("event: message_start");
    expect(body.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(
      true,
    );

    expect(capturedRequests.anthropic[0]).toMatchObject({ stream: true });
  });

  it("anthropic → ollama stream:true streams SSE", async () => {
    setPair("anthropic", "ollama");

    const res = await postStream("/v1/messages", {
      ...(anthropicFixtures.requests.basic as Record<string, unknown>),
      stream: true,
    });

    // Streams in the source's format — Anthropic event-typed SSE.
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("event: message_start");
    expect(body.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(
      true,
    );

    // The upstream request asked for a stream (spec §3.2).
    expect(capturedRequests.ollama[0]).toMatchObject({ stream: true });
  });

  it("openai → ollama stream:true streams SSE", async () => {
    setPair("openai", "ollama");

    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    // Streams in the source's format — OpenAI SSE chunks plus [DONE].
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("data: {");
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);

    expect(capturedRequests.ollama[0]).toMatchObject({ stream: true });
  });

  it("ollama → openai stream:true streams NDJSON", async () => {
    setPair("ollama", "openai");

    const res = await postStream("/api/chat", {
      ...(ollamaFixtures.requests.basic as Record<string, unknown>),
      stream: true,
    });

    // Streams in the source's format — Ollama NDJSON ending in a
    // `done: true` line.
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const body = res.body as string;
    const lines = body.split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) JSON.parse(line);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ done: true });

    expect(capturedRequests.openai[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("stream request upstream 404 → JSON error in source dialect", async () => {
    server.use(
      http.post(`${MOCK_BASE_URLS.openai}/v1/chat/completions`, () =>
        HttpResponse.json(
          {
            error: {
              message: "model not found",
              type: "invalid_request_error",
              param: null,
              code: "model_not_found",
            },
          },
          { status: 404 },
        ),
      ),
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .send(STREAM_BODY);

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(res.body).toEqual(
      adapters.openai.fromCanonicalError(
        makeCanonicalError("not_found", "model not found"),
      ),
    );
  });

  it("truncated upstream → client receives in-stream error", async () => {
    // No [DONE] marker: the socket just closes mid-stream.
    const sse = readFileSync(
      join(__dirname, "..", "fixtures", "streams", "openai", "text.sse"),
      "utf8",
    ).replace(/\ndata: \[DONE\]\s*$/, "\n");
    server.use(
      http.post(
        `${MOCK_BASE_URLS.openai}/v1/chat/completions`,
        () =>
          new HttpResponse(sse, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );

    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    expect(res.status).toBe(200);
    const body = res.body as string;
    expect(body).toContain('data: {"error"');
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("client disconnect aborts upstream", async () => {
    let upstreamAborted = false;
    const aborted = new Promise<void>((resolve) => {
      server.use(
        http.post(
          `${MOCK_BASE_URLS.openai}/v1/chat/completions`,
          ({ request }) => {
            request.signal.addEventListener("abort", () => {
              upstreamAborted = true;
              resolve();
            });
            const first = new TextEncoder().encode(
              'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n',
            );
            return new HttpResponse(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(first);
                  // then stalls forever — disconnect is the only way out
                },
                cancel() {
                  upstreamAborted = true;
                  resolve();
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            );
          },
        ),
      );
    });

    const listener = app.listen(0);
    try {
      const port = (listener.address() as AddressInfo).port;
      const ac = new AbortController();
      const res = await fetch(
        `http://127.0.0.1:${port}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(STREAM_BODY),
          signal: ac.signal,
        },
      );
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      ac.abort();
      await Promise.race([
        aborted,
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    } finally {
      listener.close();
    }

    expect(upstreamAborted).toBe(true);
  });

  it("idle timeout → in-stream timeout error", async () => {
    process.env.UPSTREAM_STREAM_IDLE_MS = "50";
    resetConfig();

    server.use(
      http.post(`${MOCK_BASE_URLS.openai}/v1/chat/completions`, () => {
        const first = new TextEncoder().encode(
          'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n',
        );
        return new HttpResponse(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(first);
              // stalls — the idle timeout must end the stream
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }),
    );

    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    expect(res.status).toBe(200);
    const body = res.body as string;
    expect(body).toContain('data: {"error"');
    expect(body).toContain('"code":"timeout"');
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("stream longer than UPSTREAM_TIMEOUT_MS completes", async () => {
    // UPSTREAM_TIMEOUT_MS covers connect + headers only (spec §3.2); a
    // healthy stream may run far longer.
    process.env.UPSTREAM_TIMEOUT_MS = "100";
    resetConfig();

    const sse = readFileSync(
      join(__dirname, "..", "fixtures", "streams", "openai", "text.sse"),
    );
    const split = sse.indexOf("\n\n") + 2;
    server.use(
      http.post(
        `${MOCK_BASE_URLS.openai}/v1/chat/completions`,
        () =>
          new HttpResponse(
            new ReadableStream<Uint8Array>({
              async start(controller) {
                controller.enqueue(sse.subarray(0, split));
                await new Promise((r) => setTimeout(r, 300));
                controller.enqueue(sse.subarray(split));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );

    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    expect(res.status).toBe(200);
    const body = res.body as string;
    expect(body).not.toContain('data: {"error"');
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("upstream stalls after [DONE] → stream ends at [DONE], no error", async () => {
    // message_end is terminal: the pipe must end there even when the
    // upstream keeps the body open — not wait for the idle timeout and
    // emit an error after it.
    process.env.UPSTREAM_STREAM_IDLE_MS = "50";
    resetConfig();

    let upstreamAborted = false;
    const aborted = new Promise<void>((resolve) => {
      server.use(
        http.post(
          `${MOCK_BASE_URLS.openai}/v1/chat/completions`,
          ({ request }) => {
            request.signal.addEventListener("abort", () => {
              upstreamAborted = true;
              resolve();
            });
            const sse = readFileSync(
              join(
                __dirname,
                "..",
                "fixtures",
                "streams",
                "openai",
                "text.sse",
              ),
            );
            return new HttpResponse(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(sse);
                  // stalls — the fixture's [DONE] must end the stream
                },
                cancel() {
                  upstreamAborted = true;
                  resolve();
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            );
          },
        ),
      );
    });

    const res = await postStream("/v1/chat/completions", STREAM_BODY);

    expect(res.status).toBe(200);
    const body = res.body as string;
    expect(body).not.toContain('data: {"error"');
    expect(body.split("data: [DONE]").length - 1).toBe(1);
    await Promise.race([
      aborted,
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    expect(upstreamAborted).toBe(true);
  });

  it("stream request upstream 429 → JSON error in source dialect with Retry-After", async () => {
    server.use(
      http.post(`${MOCK_BASE_URLS.openai}/v1/chat/completions`, () =>
        HttpResponse.json(
          {
            error: {
              message: "upstream says no",
              type: "invalid_request_error",
              param: null,
              code: "test_code",
            },
          },
          { status: 429, headers: { "Retry-After": "7" } },
        ),
      ),
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .send(STREAM_BODY);

    expect(res.status, JSON.stringify(res.body)).toBe(429);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(res.body).toEqual(
      adapters.openai.fromCanonicalError(
        makeCanonicalError("rate_limit", "upstream says no"),
      ),
    );
    expect(res.headers["retry-after"]).toBe("7");
  });

  it("stream request upstream 401 → JSON error in source dialect", async () => {
    server.use(
      http.post(`${MOCK_BASE_URLS.openai}/v1/chat/completions`, () =>
        HttpResponse.json(
          {
            error: {
              message: "upstream says no",
              type: "invalid_request_error",
              param: null,
              code: "test_code",
            },
          },
          { status: 401 },
        ),
      ),
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .send(STREAM_BODY);

    // The upstream rejected the proxy's key — 502 "upstream", and the
    // upstream's own message never reaches the client (D1).
    expect(res.status, JSON.stringify(res.body)).toBe(502);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(res.body).toEqual(
      adapters.openai.fromCanonicalError(
        makeCanonicalError(
          "upstream",
          "Upstream openai rejected the proxy's credentials (401)",
        ),
      ),
    );
  });
});
