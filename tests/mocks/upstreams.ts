import { http, HttpResponse } from 'msw';
import type { Provider } from '../../src/transformers';

import openaiFixtures from '../fixtures/openai.json';
import geminiFixtures from '../fixtures/gemini.json';
import ollamaFixtures from '../fixtures/ollama.json';
import anthropicFixtures from '../fixtures/anthropic.json';

/** Mock hostnames used as *_API_BASE_URL in tests */
export const MOCK_BASE_URLS: Record<Provider, string> = {
  openai: 'http://openai.mock',
  gemini: 'http://gemini.mock',
  ollama: 'http://ollama.mock',
  anthropic: 'http://anthropic.mock',
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

export const upstreamHandlers = [
  http.post(`${MOCK_BASE_URLS.openai}/v1/chat/completions`, async ({ request }) => {
    capturedRequests.openai.push(await request.json());
    capturedHeaders.openai.push(request.headers);
    const override = responseOverrides.openai;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(openaiFixtures.responses.basic);
  }),

  http.post(`${MOCK_BASE_URLS.gemini}/v1beta/models/*`, async ({ request }) => {
    capturedRequests.gemini.push(await request.json());
    capturedHeaders.gemini.push(request.headers);
    const override = responseOverrides.gemini;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(geminiFixtures.responses.basic);
  }),

  http.post(`${MOCK_BASE_URLS.ollama}/api/chat`, async ({ request }) => {
    capturedRequests.ollama.push(await request.json());
    capturedHeaders.ollama.push(request.headers);
    const override = responseOverrides.ollama;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(ollamaFixtures.responses.basic);
  }),

  http.post(`${MOCK_BASE_URLS.anthropic}/v1/messages`, async ({ request }) => {
    capturedRequests.anthropic.push(await request.json());
    capturedHeaders.anthropic.push(request.headers);
    const override = responseOverrides.anthropic;
    if (override) {
      return HttpResponse.json(override.body ?? {}, {
        status: override.status ?? 200,
      });
    }
    return HttpResponse.json(anthropicFixtures.responses.basic);
  }),
];
