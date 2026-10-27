/**
 * Tool-call argument parsing (spec §3.4). Canonical arguments are the JSON
 * string exactly as the provider sent it; encoders that need an object
 * call this. On failure the raw string is preserved under
 * `_invalid_arguments` so no information is lost.
 */
export function parseToolArguments(json: string): {
  args: Record<string, unknown>;
  valid: boolean;
} {
  if (json.trim() === "") {
    return { args: {}, valid: true };
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return { args: parsed as Record<string, unknown>, valid: true };
    }
  } catch {
    // fall through to the invalid wrapper
  }
  return { args: { _invalid_arguments: json }, valid: false };
}
