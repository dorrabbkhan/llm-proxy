declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      SOURCE_API: "OPENAI" | "GEMINI" | "OLLAMA" | "ANTHROPIC";
      TARGET_API: "OPENAI" | "GEMINI" | "OLLAMA" | "ANTHROPIC";
      OPENAI_API_KEY?: string;
      OPENAI_API_BASE_URL?: string;
      GEMINI_API_KEY?: string;
      GEMINI_API_BASE_URL?: string;
      OLLAMA_API_KEY?: string;
      OLLAMA_API_BASE_URL?: string;
      ANTHROPIC_API_KEY?: string;
      ANTHROPIC_API_BASE_URL?: string;
    }
  }
}
export {};
