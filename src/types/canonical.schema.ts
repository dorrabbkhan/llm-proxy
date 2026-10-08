import { z } from 'zod';

/**
 * Zod schemas mirroring canonical.types.ts.
 * Used for runtime contract validation of adapter outputs.
 */

const roleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

const mimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const imageSchema = z.object({
  data: z.string(),
  mimeType: mimeTypeSchema,
});

const contentPartSchema = z
  .object({
    type: z.enum(['text', 'image']),
    text: z.string().optional(),
    image: imageSchema.optional(),
  })
  .refine((p) => (p.type === 'text' ? p.text !== undefined : true), {
    message: "content part of type 'text' must have text",
  });

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export const canonicalMessageSchema = z.object({
  role: roleSchema,
  content: z.union([z.string(), z.array(contentPartSchema)]),
  toolCalls: z.array(toolCallSchema).optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

export const canonicalConfigSchema = z.object({
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().optional(),
  topK: z.number().int().positive().optional(),
  stopSequences: z.array(z.string()).optional(),
  candidateCount: z.number().int().positive().optional(),
  seed: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
});

const functionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export const canonicalToolSchema = z.object({
  type: z.literal('function'),
  function: functionSchema,
});

export const canonicalRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(canonicalMessageSchema).min(1),
  systemPrompt: z.string().optional(),
  config: canonicalConfigSchema.optional(),
  tools: z.array(canonicalToolSchema).optional(),
  stream: z.boolean().optional(),
});

export const finishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_call',
  'content_filter',
  'error',
  'unknown',
]);

export const canonicalUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const canonicalResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  message: canonicalMessageSchema,
  finishReason: finishReasonSchema,
  usage: canonicalUsageSchema.optional(),
  created: z.number().optional(),
});

export const canonicalStreamChunkSchema = z.object({
  id: z.string(),
  model: z.string(),
  delta: z.object({
    role: z.literal('assistant').optional(),
    content: z.string().optional(),
    toolCalls: z.array(toolCallSchema.partial()).optional(),
  }),
  finishReason: finishReasonSchema.optional(),
  usage: canonicalUsageSchema.optional(),
});
