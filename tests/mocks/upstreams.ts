import { readFileSync } from "node:fs";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import type { Provider } from "../../src/transformers";

import openaiFixtures from "../fixtures/openai.json";
import geminiFixtures from "../fixtures/gemini.json";
import ollamaFixtures from "../fixtures/ollama.json";
import anthropicFixtures from "../fixtures/anthropic.json";

/** Mock hostnames used as *_API_BASE_URL in tests */
export const MOCK_BASE_URLS: Record<Provider, string> = {
  openai: "http://openai.mock",
  gemini: "http://gemini.mock",
  ollama: "http://ollama.mock",
  anthropic: "http://anthropic.mock",
};

/** Captured request bodies per provider (reset between tests) */
export const capturedRequests: Record<Provider, unknown[]> = {
  openai: [],
  gemini: [],
  ollama: [],
  anthropic: [],
};

/** Captured auth headers per provider */
export const capturedHeaders: Record<Provider, Headers[]> = {
  openai: [],
  gemini: [],
  ollama: [],
  anthropic: [],
};

export function resetCaptured(): void {
  for (const p of Object.keys(capturedRequests) as Provider[]) {
    capturedRequests[p].length = 0;
    capturedHeaders[p].length = 0;
  }
}

/** Responses to return per provider — overridable per test */
export const responseOverrides: Partial<
  Record<Provider, { status?: number; body?: unknown }>
> = {};

export function resetOverrides(): void {
  for (const key of Object.keys(responseOverrides) as Provider[]) {
    delete responseOverrides[key];
  }
}

/** Which stream fixture case each provider's upstream serves (default "text") */
export const streamCase: Partial<Record<Provider, string>> = {};

export function resetStreamCase(): void {
  for (const key of Object.keys(streamCase) as Provider[]) {
    delete streamCase[key];
  }
}

const WIRE_EXT: Record<Provider, string> = {
  openai: "sse",
  anthropic: "sse",
  gemini: "sse",
  ollama: "ndjson",
};

const STREAM_CONTENT_TYPE: Record<Provider, string> = {
  openai: "text/event-stream",
  anthropic: "text/event-stream",
  gemini: "text/event-stream",
  ollama: "application/x-ndjson",
};

/**
 * Serve the recorded stream corpus as the upstream reply, in 7-byte
 * chunks so split-point handling is exercised on every proxied stream.
 */
function streamFixtureResponse(provider: Provider): HttpResponse {
  const name = streamCase[provider] ?? "text";
  const file = join(
    __dirname,
    "..",
    "fixtures",
    "streams",
    provider,
    `${name}.${WIRE_EXT[provider]}`,
  );
  const bytes = readFileSync(file);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) {
        controller.enqueue(bytes.subarray(i, i + 7));
      }
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    headers: { "content-type": STREAM_CONTENT_TYPE[provider] },
  });
}

/** A request body asks for a stream via `stream:true` (or the Gemini path). */
function wantsStream(url: string, body: unknown): boolean {
  if (url.includes(":streamGenerateContent")) return true;
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { stream?: unknown }).stream === true
  );
}

export const upstreamHandlers = [
  http.post(
    `${MOCK_BASE_URLS.openai}/v1/chat/completions`,
    async ({ request }) => {
      const body = await request.json();
      capturedRequests.openai.push(body);
      capturedHeaders.openai.push(request.headers);
      const override = responseOverrides.openai;
      if (override) {
        return HttpResponse.json(override.body ?? {}, {
          status: override.status ?? 200,
        });
      }
      if (wantsStream(request.url, body)) {
        return streamFixtureResponse("openai");
      }
      return HttpResponse.json(openaiFixtures.responses.basic);
    },
  ),

  http.post(`${MOCK_BASE_URLS.gemini}/v1beta/models/*`, async ({ request }) => {
    const body = await request.json();
    capturedRequests.gemini.push(body);
    capturedHeaders.gemini.push(request.headers);
    const override = responseOverrides.gemini;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    if (wantsStream(request.url, body)) {
      return streamFixtureResponse("gemini");
    }
    return HttpResponse.json(geminiFixtures.responses.basic);
  }),

  http.post(`${MOCK_BASE_URLS.ollama}/api/chat`, async ({ request }) => {
    const body = await request.json();
    capturedRequests.ollama.push(body);
    capturedHeaders.ollama.push(request.headers);
    const override = responseOverrides.ollama;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    if (wantsStream(request.url, body)) {
      return streamFixtureResponse("ollama");
    }
    return HttpResponse.json(ollamaFixtures.responses.basic);
  }),

  http.post(`${MOCK_BASE_URLS.anthropic}/v1/messages`, async ({ request }) => {
    const body = await request.json();
    capturedRequests.anthropic.push(body);
    capturedHeaders.anthropic.push(request.headers);
    const override = responseOverrides.anthropic;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    if (wantsStream(request.url, body)) {
      return streamFixtureResponse("anthropic");
    }
    return HttpResponse.json(anthropicFixtures.responses.basic);
  }),

  // ===== Model list endpoints =====

  http.get(`${MOCK_BASE_URLS.openai}/v1/models`, ({ request }) => {
    capturedHeaders.openai.push(request.headers);
    const override = responseOverrides.openai;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(openaiFixtures.models);
  }),

  http.get(`${MOCK_BASE_URLS.gemini}/v1beta/models`, ({ request }) => {
    capturedHeaders.gemini.push(request.headers);
    const override = responseOverrides.gemini;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(geminiFixtures.models);
  }),

  http.get(`${MOCK_BASE_URLS.ollama}/api/tags`, ({ request }) => {
    capturedHeaders.ollama.push(request.headers);
    const override = responseOverrides.ollama;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(ollamaFixtures.models);
  }),

  http.get(`${MOCK_BASE_URLS.anthropic}/v1/models`, ({ request }) => {
    capturedHeaders.anthropic.push(request.headers);
    const override = responseOverrides.anthropic;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(anthropicFixtures.models);
  }),
];
