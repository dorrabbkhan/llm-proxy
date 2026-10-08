import fs from "fs";
import path from "path";
import { parse } from "yaml";
import Ajv from "ajv";
import type { ApiMappingsConfig } from "../types/api-mapping";

const VALID_PROVIDERS = ["openai", "gemini", "ollama", "anthropic"];

/**
 * Loads API mappings from the YAML configuration file
 */
export function loadApiMappings(
  configPath: string = path.join(__dirname, "api-mappings.yaml"),
): ApiMappingsConfig {
  try {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    let fileContents: string;
    try {
      fileContents = fs.readFileSync(configPath, "utf8");
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code === "EACCES") {
        throw new Error(`Permission denied: Cannot access ${configPath}`);
      }
      throw new Error(
        `Failed to read configuration file: ${configPath} - ${(readError as Error).message}`,
      );
    }

    if (!fileContents.trim()) {
      throw new Error(`Configuration file is empty: ${configPath}`);
    }

    let config: ApiMappingsConfig;
    try {
      config = parse(fileContents) as ApiMappingsConfig;
    } catch (parseError) {
      throw new Error(
        `Invalid YAML format in ${configPath}: ${(parseError as Error).message}`,
      );
    }

    // Validate with JSON schema
    const ajv = new Ajv({ allErrors: true });

    const apiMappingSchema = {
      type: "object",
      required: ["mappings"],
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            required: [
              "source_api",
              "target_api",
              "proxy_path_prefix",
              "target_base_url_env_var",
            ],
            properties: {
              source_api: { type: "string", enum: VALID_PROVIDERS },
              target_api: { type: "string", enum: VALID_PROVIDERS },
              proxy_path_prefix: { type: "string" },
              target_base_url_env_var: { type: "string" },
              target_api_key_env_var: { type: ["string", "null"] },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };

    const validate = ajv.compile(apiMappingSchema);
    const valid = validate(config);

    if (!valid) {
      const errors = validate.errors || [];
      let errorMessage = "Invalid API mappings configuration:";

      errors.forEach((error) => {
        const errorPath = error.instancePath || "";
        const property =
          error.params.missingProperty || error.params.additionalProperty || "";
        const index = errorPath.match(/\/mappings\/([0-9]+)/)?.[1];

        if (error.keyword === "required" && index !== undefined) {
          errorMessage += `\n- Invalid mapping at index ${index}: missing ${property}`;
        } else if (
          error.keyword === "additionalProperties" &&
          index !== undefined
        ) {
          errorMessage += `\n- Invalid mapping at index ${index}: unknown property '${property}'`;
        } else if (error.keyword === "enum") {
          errorMessage += `\n- ${errorPath}: must be one of ${VALID_PROVIDERS.join(", ")}`;
        } else {
          errorMessage += `\n- ${error.message} at ${errorPath || "root"}`;
        }
      });

      throw new Error(errorMessage);
    }

    return config;
  } catch (error) {
    console.error(`Error loading API mappings from ${configPath}:`, error);

    if (error instanceof Error) {
      throw new Error(`Failed to load API mappings: ${error.message}`);
    }
    throw new Error("Failed to load API mappings: Unknown error occurred");
  }
}
