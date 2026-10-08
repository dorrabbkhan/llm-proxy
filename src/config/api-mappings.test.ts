import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parse } from "yaml";
import type { ApiMappingsConfig, ApiMapping } from "../types/api-mapping";

describe("API Mappings Structure", () => {
  const yamlPath = path.join(__dirname, "api-mappings.yaml");

  it("should parse the YAML file without errors", () => {
    const fileContents = fs.readFileSync(yamlPath, "utf8");
    const config = parse(fileContents) as ApiMappingsConfig;
    expect(config).toBeDefined();
    expect(config.mappings).toBeDefined();
    expect(Array.isArray(config.mappings)).toBe(true);
  });

  it("should have valid mapping entries that match the ApiMapping interface", () => {
    const fileContents = fs.readFileSync(yamlPath, "utf8");
    const config = parse(fileContents) as ApiMappingsConfig;

    const validProviders = ["openai", "gemini", "ollama", "anthropic"];

    config.mappings.forEach((mapping: ApiMapping) => {
      expect(mapping.source_api).toBeDefined();
      expect(mapping.target_api).toBeDefined();
      expect(mapping.proxy_path_prefix).toBeDefined();
      expect(mapping.target_base_url_env_var).toBeDefined();

      expect(validProviders).toContain(mapping.source_api);
      expect(validProviders).toContain(mapping.target_api);
      expect(mapping.proxy_path_prefix.startsWith("/")).toBe(true);
    });
  });

  it("should have at least one mapping for each provider direction", () => {
    const fileContents = fs.readFileSync(yamlPath, "utf8");
    const config = parse(fileContents) as ApiMappingsConfig;

    // Should have mappings from OpenAI to other providers
    const openaiToOthers = config.mappings.filter(
      (m) => m.source_api === "openai",
    );
    expect(openaiToOthers.length).toBeGreaterThan(0);

    // Should have mappings from other providers to OpenAI
    const othersToOpenai = config.mappings.filter(
      (m) => m.target_api === "openai",
    );
    expect(othersToOpenai.length).toBeGreaterThan(0);
  });
});
