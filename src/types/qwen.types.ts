// Qwen DashScope API types (no official SDK)
// Reference: https://help.aliyun.com/document_detail/2712576.html

// ============ REQUEST ============

export interface QwenChatRequest {
  model: string;
  input: {
    messages: QwenMessage[];
  };
  parameters?: QwenParameters;
}

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | QwenContentPart[];
}

export interface QwenContentPart {
  text?: string;
  image?: string;
}

export interface QwenParameters {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  stop?: string[];
  enable_search?: boolean;
  result_format?: 'text' | 'message';
  incremental_output?: boolean;
  seed?: number;
  repetition_penalty?: number;
}

// ============ RESPONSE ============

export interface QwenChatResponse {
  output: QwenOutput;
  usage: QwenUsage;
  request_id: string;
}

export interface QwenOutput {
  text?: string;
  choices?: QwenChoice[];
  finish_reason: 'stop' | 'length' | 'null' | null;
}

export interface QwenChoice {
  message: QwenMessage;
  finish_reason: string;
}

export interface QwenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

// ============ STREAMING ============

export interface QwenStreamChunk {
  output: {
    text: string;
    finish_reason: string | null;
  };
  usage?: QwenUsage;
  request_id: string;
}

// ============ ROLE ============

export type QwenRole = 'system' | 'user' | 'assistant';
