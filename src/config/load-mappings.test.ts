import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { loadApiMappings } from "./load-mappings";

vi.mock("fs");
vi.mock("path");

describe("loadApiMappings", () => {
  const mockYamlContent = `
mappings:
  - source_api: "OPENAI"
    target_api: "GEMINI"
    proxy_path_prefix: "/v1/chat/completions"
    target_base_url_env_var: "GEMINI_API_BASE_URL"
    target_api_key_env_var: "GEMINI_API_KEY"
    request_transform: "openaiToGeminiChat"
    response_transform: "geminiToOpenAIChat"
  `;

  const mockInvalidYamlContent = `
something_else:
  - not_a_mapping: true
  `;

  const mockIncompleteYamlContent = `
mappings:
  - source_api: "OPENAI"
    target_api: "GEMINI"
    # Missing proxy_path_prefix
    target_base_url_env_var: "GEMINI_API_BASE_URL"
    target_api_key_env_var: "GEMINI_API_KEY"
    request_transform: "openaiToGeminiChat"
    response_transform: "geminiToOpenAIChat"
  `;

  beforeEach(() => {
    vi.mocked(path.join).mockReturnValue("/mock/path/api-mappings.yaml");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should load and parse valid API mappings", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);

    const result = loadApiMappings();
    expect(fs.readFileSync).toHaveBeenCalledWith(
      "/mock/path/api-mappings.yaml",
      "utf8"
    );

    expect(result).toBeDefined();
    expect(result.mappings).toBeDefined();
    expect(result.mappings.length).toBe(1);
    expect(result.mappings[0].source_api).toBe("OPENAI");
    expect(result.mappings[0].target_api).toBe("GEMINI");
    expect(result.mappings[0].proxy_path_prefix).toBe("/v1/chat/completions");
    expect(result.mappings[0].target_base_url_env_var).toBe(
      "GEMINI_API_BASE_URL"
    );
    expect(result.mappings[0].target_api_key_env_var).toBe("GEMINI_API_KEY");
    expect(result.mappings[0].request_transform).toBe("openaiToGeminiChat");
    expect(result.mappings[0].response_transform).toBe("geminiToOpenAIChat");
  });

  it("should throw an error for invalid mappings structure", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockInvalidYamlContent);

    expect(() => loadApiMappings()).toThrow(
      'Invalid API mappings configuration: missing or invalid "mappings" array'
    );
  });

  it("should throw an error for incomplete mapping", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockIncompleteYamlContent);

    expect(() => loadApiMappings()).toThrow(
      "Invalid mapping at index 0: missing proxy_path_prefix"
    );
  });

  it("should accept a custom config path", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);

    const customPath = "/custom/path/config.yaml";
    loadApiMappings(customPath);
    expect(fs.readFileSync).toHaveBeenCalledWith(customPath, "utf8");
  });

  it("should handle fs errors properly", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("File not found");
    });
    expect(() => loadApiMappings()).toThrow("File not found");
  });
});
