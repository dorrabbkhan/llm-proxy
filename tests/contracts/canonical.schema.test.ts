import { describe, it, expect } from 'vitest';
import { adapters, type Provider } from '../../src/transformers';
import {
  canonicalRequestSchema,
  canonicalResponseSchema,
} from '../../src/types/canonical.schema';

/**
 * Contract tests: every adapter's toCanonical* output must satisfy
 * the canonical schema. This is the safety net that makes adapter-level
 * testing sufficient — if all adapters produce schema-valid canonical
 * data, any source→target pair composes correctly.
 */

// Representative provider-format inputs (one per adapter)
const PROVIDER_REQUESTS: Record<Provider, unknown> = {
  openai: {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc123' },
          },
        ],
      },
    ],
    temperature: 0.7,
    max_tokens: 150,
    top_p: 0.9,
    stop: ['END'],
  },
  gemini: {
    contents: [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi!' }] },
      {
        role: 'user',
        parts: [
          { text: 'What is this?' },
          { inlineData: { mimeType: 'image/png', data: 'abc123' } },
        ],
      },
    ],
    systemInstruction: { role: 'user', parts: [{ text: 'Be helpful' }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 150,
      topP: 0.9,
      topK: 40,
      stopSequences: ['END'],
    },
  },
  ollama: {
    model: 'llama3',
    messages: [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
      { role: 'user', content: 'What is this?', images: ['aW1hZ2U='] },
    ],
    options: {
      temperature: 0.7,
      num_predict: 150,
      top_p: 0.9,
      top_k: 40,
      stop: ['END'],
      seed: 42,
    },
  },
  anthropic: {
    model: 'claude-3-opus-20240229',
    max_tokens: 150,
    system: 'You are helpful',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'abc123',
            },
          },
        ],
      },
    ],
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    stop_sequences: ['END'],
  },
};

const PROVIDER_RESPONSES: Record<Provider, unknown> = {
  openai: {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello!', refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  },
  gemini: {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'Hello!' }] },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  },
  ollama: {
    model: 'llama3',
    created_at: new Date(),
    message: { role: 'assistant', content: 'Hello!' },
    done: true,
    done_reason: 'stop',
    total_duration: 100,
    load_duration: 10,
    prompt_eval_count: 10,
    prompt_eval_duration: 40,
    eval_count: 5,
    eval_duration: 50,
  },
  anthropic: {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-opus-20240229',
    content: [{ type: 'text', text: 'Hello!' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  },
};

const providers: Provider[] = ['openai', 'gemini', 'ollama', 'anthropic'];

describe('Canonical schema contracts', () => {
  describe.each(providers)('%s adapter', (provider) => {
    const adapter = adapters[provider];

    it('toCanonicalRequest produces schema-valid canonical output', () => {
      const canonical = adapter.toCanonicalRequest(PROVIDER_REQUESTS[provider]);

      const result = canonicalRequestSchema.safeParse(canonical);
      if (!result.success) {
        console.error(provider, result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    it('toCanonicalResponse produces schema-valid canonical output', () => {
      const canonical = adapter.toCanonicalResponse(
        PROVIDER_RESPONSES[provider],
        'test-model'
      );

      const result = canonicalResponseSchema.safeParse(canonical);
      if (!result.success) {
        console.error(provider, result.error.issues);
      }
      expect(result.success).toBe(true);
    });
  });

  it('every canonical request is accepted by every adapter (cross-compat)', () => {
    // For each source adapter, produce canonical → feed to every target adapter
    for (const source of providers) {
      const canonical = adapters[source].toCanonicalRequest(
        PROVIDER_REQUESTS[source]
      );

      for (const target of providers) {
        const result = canonicalRequestSchema.safeParse(canonical);
        expect(result.success).toBe(true);

        // Should not throw — proves canonical is a sufficient
        // superset for every target adapter
        const providerReq = adapters[target].fromCanonicalRequest(canonical);
        expect(providerReq).toBeDefined();
      }
    }
  });

  it('every canonical response is accepted by every adapter (cross-compat)', () => {
    for (const source of providers) {
      const canonical = adapters[source].toCanonicalResponse(
        PROVIDER_RESPONSES[source],
        'test-model'
      );

      for (const target of providers) {
        const providerRes = adapters[target].fromCanonicalResponse(canonical);
        expect(providerRes).toBeDefined();
      }
    }
  });
});
