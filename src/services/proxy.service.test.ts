import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proxyRequest } from './proxy.service';
import { resetConfig } from '../config/env-config';
import { UpstreamError, ValidationError } from '../utils/errors';

vi.mock('./http-client', () => ({
  postJson: vi.fn(),
}));

import { postJson } from './http-client';

const mockPostJson = vi.mocked(postJson);

const VALID_OPENAI_REQUEST = {
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
};

const OPENAI_RESPONSE_BODY = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1700000000,
  model: 'gpt-4',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hi' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
};

beforeEach(() => {
  process.env.SOURCE_API = 'openai';
  process.env.TARGET_API = 'ollama';
  process.env.OLLAMA_API_BASE_URL = 'http://ollama.test';
  process.env.OPENAI_API_BASE_URL = 'http://openai.test';
  process.env.GEMINI_API_BASE_URL = 'http://gemini.test';
  process.env.ANTHROPIC_API_BASE_URL = 'http://anthropic.test';
  process.env.GEMINI_API_KEY = 'k';
  process.env.OPENAI_API_KEY = 'k';
  process.env.ANTHROPIC_API_KEY = 'k';
  resetConfig();
  mockPostJson.mockResolvedValue({
    status: 200,
    body: {
      model: 'llama3',
      message: { role: 'assistant', content: 'Hi' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 5,
      eval_count: 1,
    },
    durationMs: 10,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('proxyRequest', () => {
  it('returns null for non-provider paths', async () => {
    expect(await proxyRequest('/random/path', {}, 'r1')).toBeNull();
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  it('returns null when path belongs to a different provider', async () => {
    // /api/chat is ollama's prefix but source is openai
    expect(
      await proxyRequest('/api/chat', VALID_OPENAI_REQUEST, 'r1')
    ).toBeNull();
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  it('throws ValidationError for malformed body', async () => {
    const err = await proxyRequest(
      '/v1/chat/completions',
      { model: 'gpt-4' }, // missing messages
      'r1'
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
  });

  it('propagates UpstreamError from http-client', async () => {
    mockPostJson.mockRejectedValue(
      new UpstreamError('upstream down', 500, {})
    );

    const err = await proxyRequest(
      '/v1/chat/completions',
      VALID_OPENAI_REQUEST,
      'r1'
    ).catch((e) => e);

    expect(err).toBeInstanceOf(UpstreamError);
  });

  it('converts non-2xx upstream status to UpstreamError', async () => {
    mockPostJson.mockResolvedValue({
      status: 401,
      body: { error: 'bad key' },
      durationMs: 5,
    });

    const err = await proxyRequest(
      '/v1/chat/completions',
      VALID_OPENAI_REQUEST,
      'r1'
    ).catch((e) => e);

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.statusCode).toBe(502);
  });

  it('builds gemini URL with model in path', async () => {
    process.env.TARGET_API = 'gemini';
    resetConfig();
    mockPostJson.mockResolvedValue({
      status: 200,
      body: {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hi' }] },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 1,
          totalTokenCount: 6,
        },
      },
      durationMs: 10,
    });

    await proxyRequest('/v1/chat/completions', VALID_OPENAI_REQUEST, 'r1');

    expect(mockPostJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://gemini.test/v1beta/models/gpt-4:generateContent',
      })
    );
  });

  it('returns transformed response in source format', async () => {
    const result = await proxyRequest(
      '/v1/chat/completions',
      VALID_OPENAI_REQUEST,
      'r1'
    );

    expect(result).not.toBeNull();
    const body = result!.body as {
      object?: string;
      choices?: { message?: { content?: string } }[];
    };
    expect(body.object).toBe('chat.completion');
    expect(body.choices![0]!.message!.content).toBe('Hi');
  });

  it('sends correct auth headers per provider', async () => {
    process.env.TARGET_API = 'anthropic';
    resetConfig();
    mockPostJson.mockResolvedValue({
      status: 200,
      body: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-3',
        content: [{ type: 'text', text: 'Hi' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 1 },
      },
      durationMs: 10,
    });

    await proxyRequest('/v1/chat/completions', VALID_OPENAI_REQUEST, 'r1');

    expect(mockPostJson).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'k',
          'anthropic-version': '2023-06-01',
        }),
      })
    );
  });
});
