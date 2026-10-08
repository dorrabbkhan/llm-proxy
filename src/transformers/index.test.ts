import { describe, it, expect } from 'vitest';
import { getTransformers, transformerRegistry } from './index';
import { ConfigurationError } from '../utils/errors';

describe('transformerRegistry', () => {
  it('should have request transformers', () => {
    expect(transformerRegistry.request).toBeDefined();
    expect(Object.keys(transformerRegistry.request).length).toBeGreaterThan(0);
  });

  it('should have response transformers', () => {
    expect(transformerRegistry.response).toBeDefined();
    expect(Object.keys(transformerRegistry.response).length).toBeGreaterThan(0);
  });

  it('should have matching request transformers', () => {
    const expectedTransformers = [
      'openaiToGeminiChat',
      'openaiToOllamaChat',
      'openaiToAnthropicChat',
      'openaiToOpenaiChat',
    ];

    for (const name of expectedTransformers) {
      expect(transformerRegistry.request[name]).toBeDefined();
      expect(typeof transformerRegistry.request[name]).toBe('function');
    }
  });

  it('should have matching response transformers', () => {
    const expectedTransformers = [
      'geminiToOpenaiChat',
      'ollamaToOpenaiChat',
      'anthropicToOpenaiChat',
      'openaiToOpenaiChat',
    ];

    for (const name of expectedTransformers) {
      expect(transformerRegistry.response[name]).toBeDefined();
      expect(typeof transformerRegistry.response[name]).toBe('function');
    }
  });
});

describe('getTransformers', () => {
  it('should return transformers for valid names', () => {
    const result = getTransformers('openaiToGeminiChat', 'geminiToOpenaiChat');

    expect(result.requestTransform).toBeDefined();
    expect(result.responseTransform).toBeDefined();
    expect(typeof result.requestTransform).toBe('function');
    expect(typeof result.responseTransform).toBe('function');
  });

  it('should throw ConfigurationError for unknown request transformer', () => {
    expect(() => getTransformers('unknownTransform', 'geminiToOpenaiChat')).toThrow(
      ConfigurationError
    );
  });

  it('should throw ConfigurationError for unknown response transformer', () => {
    expect(() => getTransformers('openaiToGeminiChat', 'unknownTransform')).toThrow(
      ConfigurationError
    );
  });

  it('should include available transformers in error context', () => {
    try {
      getTransformers('unknownTransform', 'geminiToOpenaiChat');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).context?.availableTransformers).toBeDefined();
    }
  });

  it('should return identity transform for same-format conversions', () => {
    const result = getTransformers('openaiToOpenaiChat', 'openaiToOpenaiChat');
    const testData = { test: 'data' };

    expect(result.requestTransform(testData)).toBe(testData);
    expect(result.responseTransform(testData, 'model')).toBe(testData);
  });
});
