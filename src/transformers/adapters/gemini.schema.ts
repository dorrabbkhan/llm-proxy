/**
 * Filter a JSON Schema down to the subset the Gemini API documents for
 * function-declaration `parameters` (and responseSchema), spec §3.4.
 * Source: https://ai.google.dev/api/generate-content#Schema
 * (read 2026-10-27) — the documented fields minus `default`, which the
 * doc itself marks "accepted and ignored" (owner decision 2026-10-27).
 * Returns a new object; the input is never mutated.
 */

const ALLOWED_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "example",
  "anyOf",
  "propertyOrdering",
  "items",
  "minimum",
  "maximum",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toGeminiSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (key === "properties" && isPlainObject(value)) {
      const properties: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value)) {
        properties[name] = isPlainObject(sub) ? toGeminiSchema(sub) : sub;
      }
      out[key] = properties;
    } else if (key === "items" && isPlainObject(value)) {
      out[key] = toGeminiSchema(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      out[key] = value.map((sub) =>
        isPlainObject(sub) ? toGeminiSchema(sub) : sub,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
