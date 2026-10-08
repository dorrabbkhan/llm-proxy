import { describe, it, expect } from 'vitest';
import {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
} from './openai.adapter';
import type { CanonicalRequest, CanonicalResponse } from '../../types/canonical.types';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/openai.types';

describe('OpenAI Adapter', () => {
  describe('toCanonicalRequest', () => {
    it('should convert basic request', () => {
      const input: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = toCanonicalRequest(input);

      expect(result.model).toBe('gpt-4');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should extract system prompt', () => {
      const input: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      };

      const result = toCanonicalRequest(input);

      expect(result.systemPrompt).toBe('You are helpful');
      expect(result.messages).toHaveLength(2);
    });

    it('should convert config parameters', () => {
      const input: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.9,
        stop: ['END'],
        n: 2,
      };

      const result = toCanonicalRequest(input);

      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.maxTokens).toBe(100);
      expect(result.config?.topP).toBe(0.9);
      expect(result.config?.stopSequences).toEqual(['END']);
      expect(result.config?.candidateCount).toBe(2);
    });

    it('should handle multipart content', () => {
      const input: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
            ],
          },
        ],
      };

      const result = toCanonicalRequest(input);
      const content = result.messages[0].content;

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({ type: 'text', text: 'What is this?' });
        expect(content[1]).toEqual({
          type: 'image',
          image: { data: 'abc123', mimeType: 'image/png' },
        });
      }
    });
  });

  describe('fromCanonicalRequest', () => {
    it('should convert basic canonical request', () => {
      const input: CanonicalRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = fromCanonicalRequest(input);

      expect(result.model).toBe('gpt-4');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should convert config to OpenAI parameters', () => {
      const input: CanonicalRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        config: {
          temperature: 0.7,
          maxTokens: 100,
          topP: 0.9,
          stopSequences: ['END'],
        },
      };

      const result = fromCanonicalRequest(input);

      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(100);
      expect(result.top_p).toBe(0.9);
      expect(result.stop).toEqual(['END']);
    });
  });

  describe('toCanonicalResponse', () => {
    it('should convert basic response', () => {
      const input: ChatCompletionResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = toCanonicalResponse(input, 'gpt-4');

      expect(result.id).toBe('chatcmpl-123');
      expect(result.model).toBe('gpt-4');
      expect(result.message.role).toBe('assistant');
      expect(result.message.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
    });

    it('should map finish reasons correctly', () => {
      const makeResponse = (finish_reason: string): ChatCompletionResponse => ({
        id: 'test',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '', refusal: null },
            finish_reason: finish_reason as 'stop',
            logprobs: null,
          },
        ],
      });

      expect(toCanonicalResponse(makeResponse('stop'), 'gpt-4').finishReason).toBe('stop');
      expect(toCanonicalResponse(makeResponse('length'), 'gpt-4').finishReason).toBe('length');
      expect(toCanonicalResponse(makeResponse('tool_calls'), 'gpt-4').finishReason).toBe('tool_call');
      expect(toCanonicalResponse(makeResponse('content_filter'), 'gpt-4').finishReason).toBe('content_filter');
    });
  });

  describe('fromCanonicalResponse', () => {
    it('should convert canonical response to OpenAI format', () => {
      const input: CanonicalResponse = {
        id: 'test-123',
        model: 'gpt-4',
        message: { role: 'assistant', content: 'Hello!' },
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        created: 1234567890,
      };

      const result = fromCanonicalResponse(input);

      expect(result.id).toBe('test-123');
      expect(result.object).toBe('chat.completion');
      expect(result.model).toBe('gpt-4');
      expect(result.choices[0].message.content).toBe('Hello!');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage?.prompt_tokens).toBe(10);
      expect(result.usage?.completion_tokens).toBe(5);
    });

    it('should generate ID if not provided', () => {
      const input: CanonicalResponse = {
        id: '',
        model: 'gpt-4',
        message: { role: 'assistant', content: 'Hi' },
        finishReason: 'stop',
      };

      const result = fromCanonicalResponse(input);

      expect(result.id).toMatch(/^chatcmpl-/);
    });
  });

  describe('roundtrip', () => {
    it('should preserve data through request roundtrip', () => {
      const original: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        max_tokens: 100,
      };

      const canonical = toCanonicalRequest(original);
      const result = fromCanonicalRequest(canonical);

      expect(result.model).toBe(original.model);
      expect(result.messages.length).toBe(original.messages.length);
      expect(result.temperature).toBe(original.temperature);
      expect(result.max_tokens).toBe(original.max_tokens);
    });
  });
});
