// Ollama API types
// Reference: https://github.com/ollama/ollama/blob/main/docs/api.md

import type {
  ChatRequest,
  ChatResponse,
  GenerateRequest,
  GenerateResponse,
  Message,
  Options,
} from "ollama";

// Re-export SDK types with consistent naming
export type OllamaChatRequest = ChatRequest;
export type OllamaChatResponse = ChatResponse;
export type OllamaGenerateRequest = GenerateRequest;
export type OllamaGenerateResponse = GenerateResponse;
export type OllamaMessage = Message;
export type OllamaOptions = Partial<Options>;
export type OllamaRole = "system" | "user" | "assistant";
