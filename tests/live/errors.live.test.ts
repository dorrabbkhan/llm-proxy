import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import type { Provider } from '../../src/transformers';
import {
  requireOllama,
  liveTargets,
  liveModel,
  chatCall,
  useTarget,
} from './live.helpers';

/**
 * Live error-path suite (spec §3.3, §3.2): an unknown model against a
 * real upstream must come back as a 404 rendered in the *source*
 * provider's dialect, and a streaming request as a 501 in that dialect.
 * Shape assertions only — upstream error text isn't asserted.
 */

const SOURCES: Provider[] = ['openai', 'anthropic', 'gemini', 'ollama'];
const UNKNOWN_MODEL = 'does-not-exist-llm-proxy';

// Shape assertions for an unsupported (501) error in each source dialect.
const UNSUPPORTED_CHECKS: Record<Provider, (body: unknown) => void> = {
  openai: (b) => {
    const err = (b as { error?: { type?: string; code?: string } }).error;
    expect(err?.type).toBe('invalid_request_error');
    expect(err?.code).toBe('unsupported');
  },
  anthropic: (b) => {
    const body = b as { type?: string; error?: { type?: string } };
    expect(body.type).toBe('error');
    expect(body.error?.type).toBe('api_error');
  },
  gemini: (b) => {
    const err = (b as { error?: { code?: number; status?: string } }).error;
    expect(err?.code).toBe(501);
    expect(err?.status).toBe('UNIMPLEMENTED');
  },
  ollama: (b) => {
    expect(typeof (b as { error?: unknown }).error).toBe('string');
  },
};

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

    it.each(SOURCES.map((source) => ({ source, target })))(
      '$source → $target stream:true → 501 in source dialect',
      async ({ source, target }) => {
        useTarget(source, target);

        // Gemini signals streaming in the path, not the body.
        const call =
          source === 'gemini'
            ? {
                method: 'POST' as const,
                path: `/v1beta/models/${liveModel(target)}:streamGenerateContent`,
                body: chatCall('gemini', liveModel(target)).body,
              }
            : chatCall(source, liveModel(target), { stream: true });
        const res = await request(app).post(call.path).send(call.body);

        expect(res.status, JSON.stringify(res.body)).toBe(501);
        UNSUPPORTED_CHECKS[source](res.body);
      },
    );
  },
);
