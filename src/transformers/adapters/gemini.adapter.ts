import { randomUUID } from 'crypto';
import { FinishReason } from '@google/generative-ai';
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentPart,
  CanonicalFinishReason,
  ProviderAdapter,
} from '../../types/canonical.types';
import type {
  Content,
  GenerateContentRequest,
  GenerateContentResponse,
  Part,
  GeminiRole,
} from '../../types/gemini.types';

export const geminiAdapter: ProviderAdapter<
  GenerateContentRequest,
  GenerateContentResponse
> = {
  toCanonicalRequest,
  fromCanonicalRequest,
  toCanonicalResponse,
  fromCanonicalResponse,
};

// ============ REQUEST: Gemini → Canonical ============

export function toCanonicalRequest(
  request: GenerateContentRequest
): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  let systemPrompt: string | undefined;

  // Extract system instruction
  if (request.systemInstruction) {
    systemPrompt = extractTextFromInstruction(request.systemInstruction);
  }

  // Convert contents to messages
  for (const content of request.contents) {
    messages.push({
      role: content.role === 'model' ? 'assistant' : 'user',
      content: extractContentParts(content),
    });
  }

  const result: CanonicalRequest = {
    model: 'gemini-pro',
    messages,
    ...(systemPrompt && { systemPrompt }),
  };

  // Convert generation config
  if (request.generationConfig) {
    const gc = request.generationConfig;
    result.config = {
      ...(gc.temperature !== undefined && { temperature: gc.temperature }),
      ...(gc.maxOutputTokens !== undefined && { maxTokens: gc.maxOutputTokens }),
      ...(gc.topP !== undefined && { topP: gc.topP }),
      ...(gc.topK !== undefined && { topK: gc.topK }),
      ...(gc.stopSequences && { stopSequences: gc.stopSequences }),
      ...(gc.candidateCount !== undefined && { candidateCount: gc.candidateCount }),
    };
  }

  return result;
}

function extractTextFromInstruction(
  instruction: GenerateContentRequest['systemInstruction']
): string {
  if (!instruction) return '';
  if (typeof instruction === 'string') return instruction;
  if ('text' in instruction && typeof instruction.text === 'string') {
    return instruction.text;
  }
  if ('parts' in instruction) {
    return (instruction as Content).parts
      .filter((p): p is { text: string } => 'text' in p)
      .map((p) => p.text)
      .join('');
  }
  return '';
}

function extractContentParts(content: Content): string | CanonicalContentPart[] {
  if (!content.parts || content.parts.length === 0) {
    return '';
  }

  // If all parts are text, join them
  const allText = content.parts.every((p) => 'text' in p);
  if (allText) {
    return content.parts
      .filter((p): p is { text: string } => 'text' in p)
      .map((p) => p.text)
      .join('');
  }

  // Mixed content
  return content.parts.map((part): CanonicalContentPart => {
    if ('text' in part) {
      return { type: 'text', text: part.text };
    }
    if ('inlineData' in part && part.inlineData) {
      return {
        type: 'image',
        image: {
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType as CanonicalContentPart['image'] extends { mimeType: infer T } ? T : never,
        },
      };
    }
    return { type: 'text', text: '' };
  });
}

// ============ REQUEST: Canonical → Gemini ============

export function fromCanonicalRequest(
  request: CanonicalRequest
): GenerateContentRequest {
  const contents: Content[] = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: mapRoleToGemini(m.role),
      parts: convertToParts(m.content),
    }));

  const result: GenerateContentRequest = {
    contents,
  };

  // Add system instruction
  const systemMsg = request.messages.find((m) => m.role === 'system');
  if (systemMsg || request.systemPrompt) {
    const systemText =
      request.systemPrompt ||
      (typeof systemMsg?.content === 'string' ? systemMsg.content : '');
    if (systemText) {
      result.systemInstruction = {
        role: 'user' as GeminiRole,
        parts: [{ text: systemText }],
      };
    }
  }

  // Add generation config
  if (request.config) {
    const c = request.config;
    result.generationConfig = {
      ...(c.temperature !== undefined && { temperature: c.temperature }),
      ...(c.maxTokens !== undefined && { maxOutputTokens: c.maxTokens }),
      ...(c.topP !== undefined && { topP: c.topP }),
      ...(c.topK !== undefined && { topK: c.topK }),
      ...(c.stopSequences && { stopSequences: c.stopSequences }),
      ...(c.candidateCount !== undefined && { candidateCount: c.candidateCount }),
    };
  }

  return result;
}

function mapRoleToGemini(role: CanonicalMessage['role']): GeminiRole {
  return role === 'assistant' ? 'model' : 'user';
}

function convertToParts(content: string | CanonicalContentPart[]): Part[] {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  return content.map((part): Part => {
    if (part.type === 'text') {
      return { text: part.text || '' };
    }
    if (part.type === 'image' && part.image) {
      return {
        inlineData: {
          mimeType: part.image.mimeType,
          data: part.image.data,
        },
      };
    }
    return { text: '' };
  });
}

// ============ RESPONSE: Gemini → Canonical ============

export function toCanonicalResponse(
  response: GenerateContentResponse,
  model: string
): CanonicalResponse {
  const candidate = response.candidates?.[0];
  const content = candidate?.content;
  const textPart = content?.parts?.find((p): p is { text: string } => 'text' in p);

  return {
    id: `gemini-${randomUUID()}`,
    model,
    message: {
      role: 'assistant',
      content: textPart?.text ?? '',
    },
    finishReason: mapFinishReason(candidate?.finishReason),
    usage: response.usageMetadata
      ? {
          inputTokens: response.usageMetadata.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        }
      : undefined,
  };
}

function mapFinishReason(reason: FinishReason | string | undefined): CanonicalFinishReason {
  switch (reason) {
    case FinishReason.STOP:
    case 'STOP':
      return 'stop';
    case FinishReason.MAX_TOKENS:
    case 'MAX_TOKENS':
      return 'length';
    case FinishReason.SAFETY:
    case 'SAFETY':
    case FinishReason.RECITATION:
    case 'RECITATION':
      return 'content_filter';
    default:
      return 'stop';
  }
}

// ============ RESPONSE: Canonical → Gemini ============

export function fromCanonicalResponse(
  response: CanonicalResponse
): GenerateContentResponse {
  const content =
    typeof response.message.content === 'string'
      ? response.message.content
      : '';

  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: content }],
        },
        finishReason: mapToGeminiFinishReason(response.finishReason),
        index: 0,
      },
    ],
    usageMetadata: response.usage
      ? {
          promptTokenCount: response.usage.inputTokens,
          candidatesTokenCount: response.usage.outputTokens,
          totalTokenCount: response.usage.totalTokens,
        }
      : undefined,
  };
}

function mapToGeminiFinishReason(reason: CanonicalFinishReason): FinishReason {
  switch (reason) {
    case 'stop':
      return FinishReason.STOP;
    case 'length':
      return FinishReason.MAX_TOKENS;
    case 'content_filter':
      return FinishReason.SAFETY;
    default:
      return FinishReason.STOP;
  }
}
