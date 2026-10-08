import { describe, it, expect } from 'vitest';
import {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
} from './anthropic.adapter';
import type { CanonicalRequest, CanonicalResponse } from '../../types/canonical.types';
import type { MessageCreateParams, Message } from '../../types/anthropic.types';

// Helper to create test Message objects
function createTestMessage(
  overrides: Partial<Message> & { content: Message['content'] }
): Message {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-opus-20240229',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
    ...overrides,
  } as Message;
}

describe('Anthropic Adapter', () => {
  describe('toCanonicalRequest', () => {
    it('should convert basic request', () => {
      const input: MessageCreateParams = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      };

      const result = toCanonicalRequest(input);

      expect(result.model).toBe('claude-3-opus-20240229');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should extract system prompt', () => {
      const input: MessageCreateParams = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
        system: 'You are helpful',
      };

      const result = toCanonicalRequest(input);

      expect(result.systemPrompt).toBe('You are helpful');
      // System should also be added as first message
      expect(result.messages[0].role).toBe('system');
    });

    it('should convert config parameters', () => {
      const input: MessageCreateParams = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        stop_sequences: ['END'],
      };

      const result = toCanonicalRequest(input);

      expect(result.config?.maxTokens).toBe(100);
      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.topP).toBe(0.9);
      expect(result.config?.topK).toBe(40);
      expect(result.config?.stopSequences).toEqual(['END']);
    });

    it('should handle multipart content', () => {
      const input: MessageCreateParams = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = toCanonicalRequest(input);
      const content = result.messages[0].content;

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({ type: 'text', text: 'What is this?' });
        expect(content[1].type).toBe('image');
        expect(content[1].image?.data).toBe('abc123');
      }
    });
  });

  describe('fromCanonicalRequest', () => {
    it('should convert basic canonical request', () => {
      const input: CanonicalRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = fromCanonicalRequest(input);

      expect(result.model).toBe('claude-3-opus-20240229');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.max_tokens).toBe(4096); // Default
    });

    it('should add system from systemPrompt', () => {
      const input: CanonicalRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are helpful',
      };

      const result = fromCanonicalRequest(input);

      expect(result.system).toBe('You are helpful');
    });

    it('should filter out system messages', () => {
      const input: CanonicalRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hello' },
        ],
      };

      const result = fromCanonicalRequest(input);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should convert config to Anthropic parameters', () => {
      const input: CanonicalRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        config: {
          maxTokens: 100,
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          stopSequences: ['END'],
        },
      };

      const result = fromCanonicalRequest(input);

      expect(result.max_tokens).toBe(100);
      expect(result.temperature).toBe(0.7);
      expect(result.top_p).toBe(0.9);
      expect(result.top_k).toBe(40);
      expect(result.stop_sequences).toEqual(['END']);
    });

    it('should handle multipart content with images', () => {
      const input: CanonicalRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', image: { data: 'abc123', mimeType: 'image/png' } },
            ],
          },
        ],
      };

      const result = fromCanonicalRequest(input);
      const content = result.messages[0].content;

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({ type: 'text', text: 'What is this?' });
        expect(content[1]).toEqual({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
        });
      }
    });
  });

  describe('toCanonicalResponse', () => {
    it('should convert basic response', () => {
      const input = createTestMessage({
        content: [{ type: 'text', text: 'Hello!' }] as Message['content'],
        usage: { input_tokens: 10, output_tokens: 5 } as Message['usage'],
      });

      const result = toCanonicalResponse(input, 'claude-3-opus');

      expect(result.model).toBe('claude-3-opus');
      expect(result.message.role).toBe('assistant');
      expect(result.message.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
      expect(result.usage?.totalTokens).toBe(15);
    });

    it('should map stop reasons correctly', () => {
      const endTurn = createTestMessage({
        content: [{ type: 'text', text: '' }] as Message['content'],
        stop_reason: 'end_turn',
      });
      const maxTokens = createTestMessage({
        content: [{ type: 'text', text: '' }] as Message['content'],
        stop_reason: 'max_tokens',
      });
      const toolUse = createTestMessage({
        content: [{ type: 'text', text: '' }] as Message['content'],
        stop_reason: 'tool_use',
      });

      expect(toCanonicalResponse(endTurn, 'claude').finishReason).toBe('stop');
      expect(toCanonicalResponse(maxTokens, 'claude').finishReason).toBe('length');
      expect(toCanonicalResponse(toolUse, 'claude').finishReason).toBe('tool_call');
    });

    it('should concatenate multiple text blocks', () => {
      const input = createTestMessage({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'World!' },
        ] as Message['content'],
      });

      const result = toCanonicalResponse(input, 'claude');

      expect(result.message.content).toBe('Hello World!');
    });
  });

  describe('fromCanonicalResponse', () => {
    it('should convert canonical response to Anthropic format', () => {
      const input: CanonicalResponse = {
        id: 'test-123',
        model: 'claude-3-opus',
        message: { role: 'assistant', content: 'Hello!' },
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      const result = fromCanonicalResponse(input);

      expect(result.id).toBe('test-123');
      expect(result.model).toBe('claude-3-opus');
      expect(result.content).toHaveLength(1);
      expect((result.content[0] as { text: string }).text).toBe('Hello!');
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage.input_tokens).toBe(10);
      expect(result.usage.output_tokens).toBe(5);
    });

    it('should map finish reasons back to Anthropic format', () => {
      const makeCanonical = (finishReason: CanonicalResponse['finishReason']): CanonicalResponse => ({
        id: 'test',
        model: 'claude',
        message: { role: 'assistant', content: '' },
        finishReason,
      });

      expect(fromCanonicalResponse(makeCanonical('stop')).stop_reason).toBe('end_turn');
      expect(fromCanonicalResponse(makeCanonical('length')).stop_reason).toBe('max_tokens');
      expect(fromCanonicalResponse(makeCanonical('tool_call')).stop_reason).toBe('tool_use');
    });
  });

  describe('roundtrip', () => {
    it('should preserve data through request roundtrip', () => {
      const original: MessageCreateParams = {
        model: 'claude-3-opus-20240229',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        max_tokens: 100,
        temperature: 0.7,
        system: 'Be helpful',
      };

      const canonical = toCanonicalRequest(original);
      const result = fromCanonicalRequest(canonical);

      expect(result.model).toBe(original.model);
      expect(result.max_tokens).toBe(original.max_tokens);
      expect(result.temperature).toBe(original.temperature);
      expect(result.system).toBe(original.system);
    });
  });
});
