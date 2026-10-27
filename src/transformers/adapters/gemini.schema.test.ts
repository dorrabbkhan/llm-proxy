import { describe, it, expect } from "vitest";
import { toGeminiSchema } from "./gemini.schema";

describe("toGeminiSchema", () => {
  it("toGeminiSchema drops $schema, additionalProperties and default at every depth", () => {
    // Claude Code-style edit-tool schema with nested objects and arrays
    const input = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      default: {},
      properties: {
        file_path: {
          type: "string",
          description: "The file to edit",
          default: "/tmp/x",
        },
        edits: {
          type: "array",
          additionalProperties: false,
          items: {
            type: "object",
            $schema: "http://json-schema.org/draft-07/schema#",
            default: {},
            properties: {
              old_string: { type: "string", default: "" },
              new_string: { type: "string" },
            },
            required: ["old_string", "new_string"],
            additionalProperties: false,
          },
        },
      },
      required: ["file_path"],
    };

    expect(toGeminiSchema(input)).toEqual({
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The file to edit",
        },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["file_path"],
    });
  });

  it("toGeminiSchema drops unknown keys inside anyOf too", () => {
    const input = {
      type: "object",
      properties: {
        value: {
          anyOf: [
            { type: "string", default: "x" },
            { type: "number", minimum: 0 },
          ],
        },
      },
    };

    expect(toGeminiSchema(input)).toEqual({
      type: "object",
      properties: {
        value: {
          anyOf: [{ type: "string" }, { type: "number", minimum: 0 }],
        },
      },
    });
  });

  it("toGeminiSchema keeps documented keywords", () => {
    const documented = {
      type: "object",
      format: "custom",
      title: "Args",
      description: "desc",
      nullable: true,
      enum: ["A", "B"],
      properties: { a: { type: "string" } },
      required: ["a"],
      minProperties: "1",
      maxProperties: "5",
      propertyOrdering: ["a"],
      items: { type: "string" },
      anyOf: [{ type: "string" }],
      minItems: "1",
      maxItems: "9",
      minLength: "1",
      maxLength: "10",
      pattern: "^a+$",
      example: { a: "b" },
      minimum: 1,
      maximum: 99,
    };

    expect(toGeminiSchema(documented)).toEqual(documented);
  });

  it("does not mutate the input schema", () => {
    const input = {
      type: "object",
      default: {},
      properties: { a: { type: "string", default: "x" } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    toGeminiSchema(input);

    expect(input).toEqual(snapshot);
  });
});
