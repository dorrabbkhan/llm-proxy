import { describe, it, expect } from 'vitest';
import { FinishReason } from '@google/generative-ai';
import {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
} from './gemini.adapter';
import type { CanonicalRequest, CanonicalResponse } from '../../types/canonical.types';
import type { GenerateContentRequest, GenerateContentResponse, Content } from '../../types/gemini.types';

describe('Gemini Adapter', () => {
  describe('toCanonicalRequest', () => {
    it('should convert basic request', () => {
      const input: GenerateContentRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
        ],
      };

      const result = toCanonicalRequest(input);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should extract system instruction', () => {
      const input: GenerateContentRequest = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        systemInstruction: {
          role: 'user',
          parts: [{ text: 'You are helpful' }],
        },
      };

      const result = toCanonicalRequest(input);

      expect(result.systemPrompt).toBe('You are helpful');
    });

    it('should map model role to assistant', () => {
      const input: GenerateContentRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
        ],
      };

      const result = toCanonicalRequest(input);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should convert generation config', () => {
      const input: GenerateContentRequest = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
          topP: 0.9,
          topK: 40,
          stopSequences: ['END'],
        },
      };

      const result = toCanonicalRequest(input);

      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.maxTokens).toBe(100);
      expect(result.config?.topP).toBe(0.9);
      expect(result.config?.topK).toBe(40);
      expect(result.config?.stopSequences).toEqual(['END']);
    });

    it('should handle multipart content with images', () => {
      const input: GenerateContentRequest = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'What is this?' },
              { inlineData: { mimeType: 'image/png', data: 'abc123' } },
            ],
          },
        ],
      };

      const result = toCanonicalRequest(input);
      const content = result.messages[0].content;

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({ type: 'text', text: 'What is this?' });
        expect(content[1].type).toBe('image');
      }
    });
  });

  describe('fromCanonicalRequest', () => {
    it('should convert basic canonical request', () => {
      const input: CanonicalRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = fromCanonicalRequest(input);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('user');
      expect(result.contents[0].parts[0]).toEqual({ text: 'Hello' });
    });

    it('should add system instruction from systemPrompt', () => {
      const input: CanonicalRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are helpful',
      };

      const result = fromCanonicalRequest(input);

      expect(result.systemInstruction).toBeDefined();
      expect((result.systemInstruction as Content).parts[0]).toEqual({
        text: 'You are helpful',
      });
    });

    it('should filter out system messages from contents', () => {
      const input: CanonicalRequest = {
        model: 'gemini-pro',
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hello' },
        ],
      };

      const result = fromCanonicalRequest(input);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('user');
    });

    it('should convert config to generationConfig', () => {
      const input: CanonicalRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hello' }],
        config: {
          temperature: 0.7,
          maxTokens: 100,
          topP: 0.9,
          stopSequences: ['END'],
        },
      };

      const result = fromCanonicalRequest(input);

      expect(result.generationConfig?.temperature).toBe(0.7);
      expect(result.generationConfig?.maxOutputTokens).toBe(100);
      expect(result.generationConfig?.topP).toBe(0.9);
      expect(result.generationConfig?.stopSequences).toEqual(['END']);
    });

    it('should map assistant role to model', () => {
      const input: CanonicalRequest = {
        model: 'gemini-pro',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      };

      const result = fromCanonicalRequest(input);

      expect(result.contents[0].role).toBe('user');
      expect(result.contents[1].role).toBe('model');
    });
  });

  describe('toCanonicalResponse', () => {
    it('should convert basic response', () => {
      const input: GenerateContentResponse = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hello!' }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = toCanonicalResponse(input, 'gemini-pro');

      expect(result.model).toBe('gemini-pro');
      expect(result.message.role).toBe('assistant');
      expect(result.message.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
    });

    it('should generate valid id', () => {
      const input: GenerateContentResponse = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hi' }] },
            index: 0,
          },
        ],
      };

      const result = toCanonicalResponse(input, 'gemini-pro');

      expect(result.id).toMatch(/^gemini-/);
    });

    it('should map finish reasons correctly', () => {
      const makeResponse = (finishReason: FinishReason): GenerateContentResponse => ({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '' }] },
            finishReason,
            index: 0,
          },
        ],
      });

      expect(toCanonicalResponse(makeResponse(FinishReason.STOP), 'gemini-pro').finishReason).toBe('stop');
      expect(toCanonicalResponse(makeResponse(FinishReason.MAX_TOKENS), 'gemini-pro').finishReason).toBe('length');
      expect(toCanonicalResponse(makeResponse(FinishReason.SAFETY), 'gemini-pro').finishReason).toBe('content_filter');
    });
  });

  describe('fromCanonicalResponse', () => {
    it('should convert canonical response to Gemini format', () => {
      const input: CanonicalResponse = {
        id: 'test-123',
        model: 'gemini-pro',
        message: { role: 'assistant', content: 'Hello!' },
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      const result = fromCanonicalResponse(input);

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates![0].content.parts[0]).toEqual({ text: 'Hello!' });
      expect(result.candidates![0].finishReason).toBe(FinishReason.STOP);
      expect(result.usageMetadata?.promptTokenCount).toBe(10);
      expect(result.usageMetadata?.candidatesTokenCount).toBe(5);
    });

    it('should map finish reasons back to Gemini format', () => {
      const makeCanonical = (finishReason: CanonicalResponse['finishReason']): CanonicalResponse => ({
        id: 'test',
        model: 'gemini-pro',
        message: { role: 'assistant', content: '' },
        finishReason,
      });

      expect(fromCanonicalResponse(makeCanonical('stop')).candidates![0].finishReason).toBe(FinishReason.STOP);
      expect(fromCanonicalResponse(makeCanonical('length')).candidates![0].finishReason).toBe(FinishReason.MAX_TOKENS);
      expect(fromCanonicalResponse(makeCanonical('content_filter')).candidates![0].finishReason).toBe(FinishReason.SAFETY);
    });
  });

  describe('roundtrip', () => {
    it('should preserve data through request roundtrip', () => {
      const original: GenerateContentRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi!' }] },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
        },
      };

      const canonical = toCanonicalRequest(original);
      const result = fromCanonicalRequest(canonical);

      expect(result.contents.length).toBe(original.contents.length);
      expect(result.generationConfig?.temperature).toBe(original.generationConfig?.temperature);
      expect(result.generationConfig?.maxOutputTokens).toBe(original.generationConfig?.maxOutputTokens);
    });
  });
});
