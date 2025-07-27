declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      SOURCE_API: "OPENAI" | "GEMINI" | "OLLAMA" | "QWEN";
      TARGET_API: "OPENAI" | "GEMINI" | "OLLAMA" | "QWEN";
      OPENAI_API_KEY?: string;
      OPENAI_API_BASE_URL?: string;
      GEMINI_API_KEY?: string;
      GEMINI_API_BASE_URL?: string;
      OLLAMA_API_KEY?: string;
      OLLAMA_API_BASE_URL?: string;
      QWEN_API_KEY?: string;
      QWEN_API_BASE_URL?: string;
    }
  }
}
export {};
