import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { ApiMappingsConfig, ApiMapping } from "../types/api-mapping";

describe("API Mappings Structure", () => {
  const yamlPath = path.join(__dirname, "api-mappings.yaml");

  it("should parse the YAML file without errors", () => {
    const fileContents = fs.readFileSync(yamlPath, "utf8");
    const config = parse(fileContents) as ApiMappingsConfig;
    expect(config).toBeDefined();
  });

  it("should have valid mapping entries that match the ApiMapping interface", () => {
    const fileContents = fs.readFileSync(yamlPath, "utf8");
    const config = parse(fileContents) as ApiMappingsConfig;

    config.mappings.forEach((mapping: ApiMapping) => {
      expect(mapping.source_api).toBeDefined();
      expect(mapping.target_api).toBeDefined();
      expect(mapping.proxy_path_prefix).toBeDefined();
      expect(mapping.target_base_url_env_var).toBeDefined();
      expect(mapping.request_transform).toBeDefined();
      expect(mapping.response_transform).toBeDefined();

      const validProviders = ["OPENAI", "GEMINI", "OLLAMA", "QWEN"];
      expect(validProviders).toContain(mapping.source_api);
      expect(validProviders).toContain(mapping.target_api);

      expect(mapping.proxy_path_prefix.startsWith("/"));
      expect(typeof mapping.request_transform).toBe("string");
      expect(mapping.request_transform.length).toBeGreaterThan(0);
      expect(typeof mapping.response_transform).toBe("string");
      expect(mapping.response_transform.length).toBeGreaterThan(0);
    });
  });
});
