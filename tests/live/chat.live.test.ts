import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { PROVIDER_ROUTES, type Provider } from '../../src/transformers';
import {
  requireOllama,
  liveTargets,
  liveModel,
  chatCall,
  useTarget,
  SOURCE_FORMAT_CHECKS,
  MODEL_LIST_CHECKS,
  ASSISTANT_TEXT,
  USAGE_CHECKS,
  MODEL_IDS,
  LIVE_OLLAMA_MODEL,
} from './live.helpers';

/**
 * Live smoke suite: every client-facing source format through every
 * available upstream target. Shape assertions only — generated text is
 * never asserted (LLM output isn't deterministic).
 */

const SOURCES: Provider[] = ['openai', 'anthropic', 'gemini', 'ollama'];

beforeAll(requireOllama);

describe.each(liveTargets().map((target) => ({ target })))(
  'live target: $target',
  ({ target }) => {
    it.each(SOURCES.map((source) => ({ source, target })))(
      '$source → $target chat round trip',
      async ({ source, target }) => {
        useTarget(source, target);

        const call = chatCall(source, liveModel(target));
        const res = await request(app).post(call.path).send(call.body);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        SOURCE_FORMAT_CHECKS[source](res.body);
        expect(ASSISTANT_TEXT[source](res.body)).toBeTruthy();
        USAGE_CHECKS[source](res.body);
      },
    );

    it.each(SOURCES.map((source) => ({ source, target })))(
      '$source → $target model list',
      async ({ source, target }) => {
        useTarget(source, target);

        const modelsRoute = PROVIDER_ROUTES[source].find(
          (r) => r.kind === 'models',
        )!;
        const res = await request(app).get(modelsRoute.pathPrefix);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        MODEL_LIST_CHECKS[source](res.body);
        if (target === 'ollama') {
          expect(MODEL_IDS[source](res.body)).toContain(LIVE_OLLAMA_MODEL);
        }
      },
    );
  },
);
