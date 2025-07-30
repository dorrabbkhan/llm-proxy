import fs from "fs";
import path from "path";
import { parse } from "yaml";
import Ajv from "ajv";
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
    // Check if file exists before attempting to read it
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    let fileContents: string;
    try {
      fileContents = fs.readFileSync(configPath, "utf8");
    } catch (readError) {
      // Handle specific file reading errors
      if ((readError as NodeJS.ErrnoException).code === "EACCES") {
        throw new Error(`Permission denied: Cannot access ${configPath}`);
      } else {
        throw new Error(
          `Failed to read configuration file: ${configPath} - ${
            (readError as Error).message
          }`
        );
      }
    }

    // Handle empty file case
    if (!fileContents.trim()) {
      throw new Error(`Configuration file is empty: ${configPath}`);
    }

    let config: ApiMappingsConfig;
    try {
      config = parse(fileContents) as ApiMappingsConfig;
    } catch (parseError) {
      throw new Error(
        `Invalid YAML format in ${configPath}: ${(parseError as Error).message}`
      );
    }

    // Define JSON schema for API mappings validation
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
              "request_transform",
              "response_transform"
            ],
            properties: {
              source_api: { type: "string" },
              target_api: { type: "string" },
              proxy_path_prefix: { type: "string" },
              target_base_url_env_var: { type: "string" },
              target_api_key_env_var: { type: ["string", "null"] },
              request_transform: { type: "string" },
              response_transform: { type: "string" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    };
    
    const validate = ajv.compile(apiMappingSchema);
    const valid = validate(config);
    
    if (!valid) {
      const errors = validate.errors || [];
      let errorMessage = "Invalid API mappings configuration:";
      
      errors.forEach(error => {
        // Format error messages to be more user-friendly
        const path = error.instancePath || "";
        const property = error.params.missingProperty || error.params.additionalProperty || "";
        const index = path.match(/\/mappings\/([0-9]+)/)?.[1];
        
        if (error.keyword === "required" && index !== undefined) {
          errorMessage += `\n- Invalid mapping at index ${index}: missing ${property}`;
        } else if (error.keyword === "additionalProperties" && index !== undefined) {
          errorMessage += `\n- Invalid mapping at index ${index}: unknown property '${property}'`;
        } else if (error.keyword === "type" && index !== undefined) {
          errorMessage += `\n- Invalid mapping at index ${index}: ${path.split('/').pop()} must be a ${error.params.type}`;
        } else {
          errorMessage += `\n- ${error.message} at ${path || "root"}`;
        }
      });
      
      throw new Error(errorMessage);
    }

    return config;
  } catch (error) {
    // Log the error with additional context
    console.error(`Error loading API mappings from ${configPath}:`, error);

    // Rethrow with a consistent error format that includes the original message
    if (error instanceof Error) {
      throw new Error(`Failed to load API mappings: ${error.message}`);
    } else {
      throw new Error(`Failed to load API mappings: Unknown error occurred`);
    }
  }
}
