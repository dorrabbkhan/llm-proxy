/**
 * Canonical LLM API Types
 *
 * Provider-agnostic format that serves as the intermediate representation
 * for transforming between different LLM API formats.
 */

// ============ REQUEST ============

export interface CanonicalRequest {
  /** Model identifier (provider-specific, passed through) */
  model: string;
  /** Conversation messages */
  messages: CanonicalMessage[];
  /** System prompt (extracted from messages for providers that need it separate) */
  systemPrompt?: string;
  /** Generation configuration */
  config?: CanonicalConfig;
  /** Tool/function definitions */
  tools?: CanonicalTool[];
  /** Enable streaming response */
  stream?: boolean;
}

export interface CanonicalMessage {
  /** Message role */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Message content - string or multimodal parts */
  content: string | CanonicalContentPart[];
  /** Tool calls made by assistant */
  toolCalls?: CanonicalToolCall[];
  /** ID of tool call this message is responding to */
  toolCallId?: string;
  /** Optional name for the message author */
  name?: string;
}

export interface CanonicalContentPart {
  /** Content type */
  type: 'text' | 'image';
  /** Text content (when type is 'text') */
  text?: string;
  /** Image content (when type is 'image') */
  image?: CanonicalImage;
}

export interface CanonicalImage {
  /** Base64-encoded image data */
  data: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export interface CanonicalConfig {
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Nucleus sampling threshold */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Sequences that stop generation */
  stopSequences?: string[];
  /** Number of completions to generate */
  candidateCount?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
}

// ============ TOOLS ============

export interface CanonicalTool {
  /** Tool type (currently only 'function' is widely supported) */
  type: 'function';
  /** Function definition */
  function: CanonicalFunction;
}

export interface CanonicalFunction {
  /** Function name */
  name: string;
  /** Function description */
  description?: string;
  /** JSON Schema for parameters */
  parameters?: Record<string, unknown>;
}

export interface CanonicalToolCall {
  /** Unique ID for this tool call */
  id: string;
  /** Tool type */
  type: 'function';
  /** Function call details */
  function: {
    /** Function name */
    name: string;
    /** JSON-encoded arguments */
    arguments: string;
  };
}

export type CanonicalToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

// ============ RESPONSE ============

export interface CanonicalResponse {
  /** Unique response ID */
  id: string;
  /** Model that generated the response */
  model: string;
  /** Generated message */
  message: CanonicalMessage;
  /** Reason generation stopped */
  finishReason: CanonicalFinishReason;
  /** Token usage statistics */
  usage?: CanonicalUsage;
  /** Response creation timestamp (Unix seconds) */
  created?: number;
}

export type CanonicalFinishReason =
  | 'stop'
  | 'length'
  | 'tool_call'
  | 'content_filter'
  | 'error'
  | 'unknown';

export interface CanonicalUsage {
  /** Tokens in the prompt */
  inputTokens: number;
  /** Tokens in the response */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
}

// ============ STREAMING ============

export interface CanonicalStreamChunk {
  /** Chunk ID */
  id: string;
  /** Model identifier */
  model: string;
  /** Incremental content delta */
  delta: CanonicalDelta;
  /** Finish reason (only on final chunk) */
  finishReason?: CanonicalFinishReason;
  /** Usage (only on final chunk, if available) */
  usage?: CanonicalUsage;
}

export interface CanonicalDelta {
  /** Role (only on first chunk) */
  role?: 'assistant';
  /** Incremental text content */
  content?: string;
  /** Incremental tool calls */
  toolCalls?: Partial<CanonicalToolCall>[];
}

// ============ ADAPTER INTERFACE ============

export interface ProviderAdapter<TRequest, TResponse> {
  /** Convert provider request to canonical format */
  toCanonicalRequest(request: TRequest): CanonicalRequest;
  /** Convert canonical request to provider format */
  fromCanonicalRequest(request: CanonicalRequest): TRequest;
  /** Convert provider response to canonical format */
  toCanonicalResponse(response: TResponse, model: string): CanonicalResponse;
  /** Convert canonical response to provider format */
  fromCanonicalResponse(response: CanonicalResponse): TResponse;
}
