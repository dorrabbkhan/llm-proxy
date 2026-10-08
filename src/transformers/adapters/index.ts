import { openaiAdapter } from './openai.adapter';
import { geminiAdapter } from './gemini.adapter';
import { ollamaAdapter } from './ollama.adapter';
import { anthropicAdapter } from './anthropic.adapter';
import type { ProviderAdapter } from '../../types/canonical.types';

export type Provider = 'openai' | 'gemini' | 'ollama' | 'anthropic';

export const adapters: Record<Provider, ProviderAdapter<unknown, unknown>> = {
  openai: openaiAdapter as ProviderAdapter<unknown, unknown>,
  gemini: geminiAdapter as ProviderAdapter<unknown, unknown>,
  ollama: ollamaAdapter as ProviderAdapter<unknown, unknown>,
  anthropic: anthropicAdapter as ProviderAdapter<unknown, unknown>,
};

export { openaiAdapter, geminiAdapter, ollamaAdapter, anthropicAdapter };
