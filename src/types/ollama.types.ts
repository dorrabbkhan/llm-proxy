import type { Ollama } from "ollama";

// Extract types from Ollama client method parameters and return types
type OllamaClient = InstanceType<typeof Ollama>;

// Chat types
export type OllamaChatRequest = Parameters<OllamaClient["chat"]>[0];
export type OllamaChatResponse = Awaited<ReturnType<OllamaClient["chat"]>>;

// Generate types (legacy completion API)
export type OllamaGenerateRequest = Parameters<OllamaClient["generate"]>[0];
export type OllamaGenerateResponse = Awaited<
  ReturnType<OllamaClient["generate"]>
>;

// Message type
export type OllamaMessage = NonNullable<OllamaChatRequest["messages"]>[number];

// Options type
export type OllamaOptions = OllamaChatRequest["options"];

// Role type
export type OllamaRole = "system" | "user" | "assistant";
