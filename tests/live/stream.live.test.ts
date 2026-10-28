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
  type LiveTarget,
} from './live.helpers';

/**
 * Live streaming and tools suite (spec §4.6): the launch-pair sources
 * (openai, anthropic) through the always-on local Ollama target and,
 * when OPENROUTER_API_KEY is set, OpenRouter as an OpenAI-shaped target.
 * Shape assertions only — generated text is never compared, and the
 * forced-tool-call case only requires a well-formed call with parseable
 * arguments.
 */

type StreamSource = Extract<Provider, 'openai' | 'anthropic'>;
const SOURCES: StreamSource[] = ['openai', 'anthropic'];
const TARGETS: LiveTarget[] = liveTargets().filter(
  (t) => t === 'ollama' || t === 'openrouter',
);

// One weather tool per source dialect; no tool result is sent back, so
// a well-formed reply is either text or a tool call.
const TOOL_EXTRA: Record<StreamSource, Record<string, unknown>> = {
  openai: {
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather for a city.',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ],
  },
  anthropic: {
    tools: [
      {
        name: 'get_weather',
        description: 'Get the current weather for a city.',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
  },
};

// OpenAI `tool_choice: "required"` (platform.openai.com/docs/api-reference/chat)
// ↔ canonical "required" ↔ Anthropic `tool_choice: {"type":"any"}`
// (docs.claude.com/en/api/messages).
const FORCED_TOOL_CHOICE: Record<StreamSource, unknown> = {
  openai: 'required',
  anthropic: { type: 'any' },
};

interface SseEvent {
  event?: string;
  data: string;
}

/** Parse an SSE body into {event, data} records; both sources stream SSE. */
function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') });
  }
  return events;
}

function jsonData(e: SseEvent): Record<string, unknown> | undefined {
  try {
    return JSON.parse(e.data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Count of SSE events that carry a non-empty text delta to the client. */
function textDeltaCount(source: StreamSource, events: SseEvent[]): number {
  return events.filter((e) => {
    const d = jsonData(e);
    if (source === 'openai') {
      const delta = (d?.choices as { delta?: { content?: string } }[] | undefined)?.[0]
        ?.delta;
      return typeof delta?.content === 'string' && delta.content.length > 0;
    }
    return (
      e.event === 'content_block_delta' &&
      (d?.delta as { type?: string; text?: string } | undefined)?.type ===
        'text_delta' &&
      ((d?.delta as { text?: string }).text?.length ?? 0) > 0
    );
  }).length;
}

function expectUsage(source: StreamSource, events: SseEvent[]): void {
  if (source === 'openai') {
    const usageChunk = events.find((e) => {
      const d = jsonData(e);
      return d !== undefined && d.usage !== undefined;
    });
    expect(
      usageChunk,
      'no usage chunk in stream',
    ).toBeDefined();
    const usage = jsonData(usageChunk!)!.usage as {
      total_tokens?: number;
    };
    expect(usage.total_tokens).toBeGreaterThan(0);
    return;
  }
  // Anthropic: real output tokens arrive in message_delta; input tokens
  // on message_start are the local estimate (spec §3.5).
  const delta = events.find((e) => e.event === 'message_delta');
  expect(delta, 'no message_delta in stream').toBeDefined();
  const usage = (jsonData(delta!)?.usage ?? {}) as {
    output_tokens?: number;
  };
  expect(usage.output_tokens).toBeGreaterThan(0);
}

function expectWellFormedReply(source: StreamSource, body: unknown): void {
  if (source === 'openai') {
    const message = (body as { choices?: { message?: { content?: unknown; tool_calls?: unknown[] } }[] })
      .choices?.[0]?.message;
    expect(message).toBeDefined();
    expect(
      typeof message!.content === 'string' && message!.content.length > 0
        ? true
        : Array.isArray(message!.tool_calls) && message!.tool_calls.length > 0,
    ).toBe(true);
    return;
  }
  const content = (body as { content?: { type?: string }[] }).content;
  expect(Array.isArray(content)).toBe(true);
  expect(
    content!.some((b) => b.type === 'text' || b.type === 'tool_use'),
  ).toBe(true);
}

function expectForcedToolCall(source: StreamSource, body: unknown): void {
  if (source === 'openai') {
    const toolCalls = (
      body as { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] }
    ).choices?.[0]?.message?.tool_calls;
    expect(Array.isArray(toolCalls) && toolCalls.length > 0).toBe(true);
    for (const call of toolCalls!) {
      expect(() => JSON.parse(call.function!.arguments ?? '')).not.toThrow();
    }
    return;
  }
  const content = (body as { content?: { type?: string; input?: unknown }[] })
    .content;
  const toolUse = content?.find((b) => b.type === 'tool_use');
  expect(toolUse, 'no tool_use block in reply').toBeDefined();
  expect(typeof toolUse!.input === 'object' && toolUse!.input !== null).toBe(
    true,
  );
}

beforeAll(requireOllama);

describe.each(TARGETS.map((target) => ({ target })))(
  'live stream target: $target',
  ({ target }) => {
    it.each(SOURCES.map((source) => ({ source, target })))(
      '$source → $target streams text',
      async ({ source, target }) => {
        useTarget(source, target);

        const extra: Record<string, unknown> = { stream: true };
        if (source === 'openai') {
          // The OpenAI encoder only emits a usage chunk when the client
          // asked for it (stream_options.include_usage).
          extra.stream_options = { include_usage: true };
        }
        if (target === 'ollama') {
          // Same budget as chat.live.test.ts — a local model may need
          // room to finish before the token cap.
          extra.max_tokens = 512;
        }
        const call = chatCall(source, liveModel(target), extra);
        const res = await request(app).post(call.path).send(call.body);

        expect(res.status, res.text).toBe(200);
        const events = parseSse(res.text);
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(textDeltaCount(source, events)).toBeGreaterThanOrEqual(1);
        if (source === 'openai') {
          expect(events[events.length - 1]!.data).toBe('[DONE]');
        } else {
          expect(events[events.length - 1]!.event).toBe('message_stop');
        }
        expectUsage(source, events);
      },
    );

    it.each(SOURCES.map((source) => ({ source, target })))(
      '$source → $target accepts tool definitions',
      async ({ source, target }) => {
        useTarget(source, target);

        const extra: Record<string, unknown> = { ...TOOL_EXTRA[source] };
        // Room for a full tool-call JSON payload.
        extra.max_tokens = target === 'ollama' ? 512 : 256;
        const call = chatCall(source, liveModel(target), extra);
        // Ask for the weather so a tool-capable model may call the tool.
        (call.body as { messages: { role: string; content: string }[] })
          .messages = [
          { role: 'user', content: 'What is the weather in Lisbon?' },
        ];

        const res = await request(app).post(call.path).send(call.body);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expectWellFormedReply(source, res.body);
      },
    );

    if (target === 'openrouter') {
      it.each(SOURCES.map((source) => ({ source, target })))(
        '$source → $target forced tool call',
        async ({ source, target }) => {
          useTarget(source, target);

          const extra: Record<string, unknown> = {
            ...TOOL_EXTRA[source],
            tool_choice: FORCED_TOOL_CHOICE[source],
            max_tokens: 512,
          };
          const call = chatCall(source, liveModel(target), extra);
          const body = call.body as {
            messages?: { role: string; content: string }[];
          };
          body.messages = [
            { role: 'user', content: 'What is the weather in Lisbon?' },
          ];

          const res = await request(app).post(call.path).send(body);

          expect(res.status, JSON.stringify(res.body)).toBe(200);
          expectForcedToolCall(source, res.body);
        },
      );
    }
  },
);
