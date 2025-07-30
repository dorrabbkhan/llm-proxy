import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { loadApiMappings } from "./load-mappings";
import { parse } from "yaml";

vi.mock("fs");
vi.mock("path");
vi.mock("yaml");

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
    vi.mocked(fs.existsSync).mockReturnValue(true); // Default to file exists
    console.error = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should load and parse valid API mappings", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    const mockConfig = {
      mappings: [
        {
          source_api: "OPENAI",
          target_api: "GEMINI",
          proxy_path_prefix: "/v1/chat/completions",
          target_base_url_env_var: "GEMINI_API_BASE_URL",
          target_api_key_env_var: "GEMINI_API_KEY",
          request_transform: "openaiToGeminiChat",
          response_transform: "geminiToOpenAIChat",
        },
      ],
    };
    vi.mocked(parse).mockReturnValue(mockConfig);

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
    vi.mocked(parse).mockReturnValue({
      something_else: [{ not_a_mapping: true }],
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Invalid API mappings configuration:"
    );
  });

  it("should throw an error for incomplete mapping", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockIncompleteYamlContent);
    vi.mocked(parse).mockReturnValue({
      mappings: [
        {
          source_api: "OPENAI",
          target_api: "GEMINI",
          // Missing proxy_path_prefix
          target_base_url_env_var: "GEMINI_API_BASE_URL",
          target_api_key_env_var: "GEMINI_API_KEY",
          request_transform: "openaiToGeminiChat",
          response_transform: "geminiToOpenAIChat",
        },
      ],
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Invalid API mappings configuration:\n- Invalid mapping at index 0: missing proxy_path_prefix"
    );
  });

  it("should accept a custom config path", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({
      mappings: [
        {
          source_api: "OPENAI",
          target_api: "GEMINI",
          proxy_path_prefix: "/v1/chat/completions",
          target_base_url_env_var: "GEMINI_API_BASE_URL",
          target_api_key_env_var: "GEMINI_API_KEY",
          request_transform: "openaiToGeminiChat",
          response_transform: "geminiToOpenAIChat",
        },
      ],
    });

    const customPath = "/custom/path/config.yaml";
    loadApiMappings(customPath);
    expect(fs.readFileSync).toHaveBeenCalledWith(customPath, "utf8");
  });

  it("should throw an error when file doesn't exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => loadApiMappings()).toThrow(
      "Configuration file not found: /mock/path/api-mappings.yaml"
    );
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("should handle permission denied errors properly", () => {
    const permissionError = new Error(
      "EACCES: permission denied"
    ) as NodeJS.ErrnoException;
    permissionError.code = "EACCES";

    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw permissionError;
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Permission denied: Cannot access /mock/path/api-mappings.yaml"
    );
  });

  it("should handle general file reading errors properly", () => {
    const readError = new Error("Some read error");

    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw readError;
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Failed to read configuration file: /mock/path/api-mappings.yaml - Some read error"
    );
  });

  it("should throw an error for empty files", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("   \n  \t  ");

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Configuration file is empty: /mock/path/api-mappings.yaml"
    );
  });

  it("should handle YAML parsing errors", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("invalid: yaml: content: :");

    const parseError = new Error("YAML parsing error");
    vi.mocked(parse).mockImplementation(() => {
      throw parseError;
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Invalid YAML format in /mock/path/api-mappings.yaml: YAML parsing error"
    );
  });

  it("should detect additional properties", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({
      mappings: [
        {
          source_api: "OPENAI",
          target_api: "GEMINI",
          proxy_path_prefix: "/v1/chat/completions",
          target_base_url_env_var: "GEMINI_API_BASE_URL",
          target_api_key_env_var: "GEMINI_API_KEY",
          request_transform: "openaiToGeminiChat",
          response_transform: "geminiToOpenAIChat",
          unknown_property: "this should not be here",
        },
      ],
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Invalid API mappings configuration:\n- Invalid mapping at index 0: unknown property 'unknown_property'"
    );
  });
});
