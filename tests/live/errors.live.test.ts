import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import type { Provider } from '../../src/transformers';
import { requireOllama, liveTargets, chatCall, useTarget } from './live.helpers';

/**
 * Live error-path suite (spec §3.3): an unknown model against a real
 * upstream must come back as a 404 rendered in the *source* provider's
 * dialect. Shape assertions only — upstream error text isn't asserted.
 */

const SOURCES: Provider[] = ['openai', 'anthropic', 'gemini', 'ollama'];
const UNKNOWN_MODEL = 'does-not-exist-llm-proxy';

// Shape assertions for a not_found error in each source dialect.
const NOT_FOUND_CHECKS: Record<Provider, (body: unknown) => void> = {
  openai: (b) => {
    const err = (b as { error?: { type?: string; code?: string } }).error;
    expect(err?.type).toBe('not_found_error');
    expect(err?.code).toBe('not_found');
  },
  anthropic: (b) => {
    const body = b as { type?: string; error?: { type?: string } };
    expect(body.type).toBe('error');
    expect(body.error?.type).toBe('not_found_error');
  },
  gemini: (b) => {
    const err = (b as { error?: { code?: number; status?: string } }).error;
    expect(err?.code).toBe(404);
    expect(err?.status).toBe('NOT_FOUND');
  },
  ollama: (b) => {
    expect(typeof (b as { error?: unknown }).error).toBe('string');
  },
};

beforeAll(requireOllama);

describe.each(liveTargets().map((target) => ({ target })))(
  'live target: $target',
  ({ target }) => {
    it.each(SOURCES.map((source) => ({ source, target })))(
      '$source → $target unknown model → 404 in source dialect',
      async ({ source, target }) => {
        useTarget(source, target);

        const call = chatCall(source, UNKNOWN_MODEL);
        const res = await request(app).post(call.path).send(call.body);

        expect(res.status, JSON.stringify(res.body)).toBe(404);
        NOT_FOUND_CHECKS[source](res.body);
      },
    );
  },
);
