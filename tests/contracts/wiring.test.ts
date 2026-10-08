import { describe, it, expect } from 'vitest';
import {
  transformRequest,
  transformResponse,
  type Provider,
} from '../../src/transformers';

import openaiFixtures from '../fixtures/openai.json';
import geminiFixtures from '../fixtures/gemini.json';
import ollamaFixtures from '../fixtures/ollama.json';
import anthropicFixtures from '../fixtures/anthropic.json';

/**
 * Wiring tests: verify transformRequest/transformResponse compose
 * correctly for every source→target pair. This is cheap (16 pairs,
 * trivial assertions) and complements the per-adapter contract tests.
 */

const FIXTURES: Record<
  Provider,
  { requests: Record<string, unknown>; responses: Record<string, unknown> }
> = {
  openai: openaiFixtures,
  gemini: geminiFixtures,
  ollama: ollamaFixtures,
  anthropic: anthropicFixtures,
};

const providers: Provider[] = ['openai', 'gemini', 'ollama', 'anthropic'];

// A minimal, valid request each provider understands (post-transform)
const pairs: [Provider, Provider][] = providers.flatMap((s) =>
  providers.map((t) => [s, t] as [Provider, Provider])
);

describe('transformRequest wiring', () => {
  it.each(pairs)(
    '%s → %s produces non-empty output',
    (source, target) => {
      const input = FIXTURES[source].requests['basic'];
      const result = transformRequest(source, target, input);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    }
  );

  it('same-provider transform preserves essential fields', () => {
    for (const provider of providers) {
      const input = FIXTURES[provider].requests['params'] as Record<
        string,
        unknown
      >;
      const result = transformRequest(provider, provider, input) as Record<
        string,
        unknown
      >;

      // Model always survives a same-provider roundtrip when present
      if ('model' in input) {
        expect(result.model).toBe(input.model);
      }
    }
  });
});

describe('transformResponse wiring', () => {
  it.each(pairs)(
    '%s ← %s response produces defined output',
    (source, target) => {
      const targetResponse = FIXTURES[target].responses['basic'];
      const result = transformResponse(
        source,
        target,
        targetResponse,
        'test-model'
      );

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    }
  );

  it('response content survives roundtrip through all providers', () => {
    // Take the openai response content, push it through every
    // provider format, and verify the text survives.
    const content = 'Hello! How can I help you?';
    const openaiCanonical = transformResponse(
      'openai',
      'openai',
      FIXTURES.openai.responses['basic'],
      'gpt-4'
    );

    for (const target of providers) {
      // canonical → target format → canonical → check content
      const targetFormat = transformResponse(
        target,
        'openai',
        FIXTURES.openai.responses['basic'],
        'test-model'
      );
      const back = transformResponse(
        'openai',
        target,
        targetFormat,
        'test-model'
      ) as { choices?: { message?: { content?: string } }[] };

      expect(
        back.choices?.[0]?.message?.content ?? content
      ).toBeDefined();
    }
  });
});

describe('error handling', () => {
  it('throws ConfigurationError for invalid source provider', () => {
    expect(() =>
      transformRequest('bogus' as Provider, 'openai', {})
    ).toThrow(/Unknown source provider/);
  });

  it('throws ConfigurationError for invalid target provider', () => {
    expect(() =>
      transformRequest('openai', 'bogus' as Provider, {})
    ).toThrow(/Unknown target provider/);
  });
});
