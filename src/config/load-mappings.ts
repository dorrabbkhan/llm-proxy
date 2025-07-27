import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { ApiMappingsConfig } from "../types/api-mapping";

/**
 * Loads API mappings from the YAML configuration file
 * @param configPath Path to the YAML configuration file (default: api-mappings.yaml)
 * @returns Parsed API mappings configuration
 */
export function loadApiMappings(
  configPath: string = path.join(__dirname, "api-mappings.yaml")
): ApiMappingsConfig {
  try {
    const fileContents = fs.readFileSync(configPath, "utf8");
    const config = parse(fileContents) as ApiMappingsConfig;

    if (!config || !config.mappings || !Array.isArray(config.mappings)) {
      throw new Error(
        'Invalid API mappings configuration: missing or invalid "mappings" array'
      );
    }

    config.mappings.forEach((mapping, index) => {
      if (!mapping.source_api) {
        throw new Error(
          `Invalid mapping at index ${index}: missing source_api`
        );
      }
      if (!mapping.target_api) {
        throw new Error(
          `Invalid mapping at index ${index}: missing target_api`
        );
      }
      if (!mapping.proxy_path_prefix) {
        throw new Error(
          `Invalid mapping at index ${index}: missing proxy_path_prefix`
        );
      }
      if (!mapping.target_base_url_env_var) {
        throw new Error(
          `Invalid mapping at index ${index}: missing target_base_url_env_var`
        );
      }
      if (!mapping.request_transform) {
        throw new Error(
          `Invalid mapping at index ${index}: missing request_transform`
        );
      }
      if (!mapping.response_transform) {
        throw new Error(
          `Invalid mapping at index ${index}: missing response_transform`
        );
      }
    });

    return config;
  } catch (error) {
    console.error("Error loading API mappings:", error);
    throw error;
  }
}
