import { ConfigurationError } from "./errors";
import { globMatch } from "../routing/rules";

// The glob matcher moved to routing/rules.ts with the routing layer;
// re-exported so existing model-map imports keep working.
export { globMatch } from "../routing/rules";

/**
 * MODEL_MAP rules (spec §3.5): ordered `glob=model` entries separated by
 * commas, e.g. "claude-*haiku*=qwen2.5-coder:7b,claude-*=qwen3-coder:30b".
 * Applied to the canonical model after decoding; the first match wins.
 */
export interface ModelMapRule {
  pattern: string;
  model: string;
}

/**
 * Comma-separated `glob=model` entries → ordered rules. An entry that
 * isn't `glob=model` (empty pattern or model, no `=`) is a configuration
 * error — it fails at startup, not at request time.
 */
export function parseModelMap(value: string | undefined): ModelMapRule[] {
  if (value === undefined || value.trim() === "") return [];

  return value.split(",").map((raw) => {
    const entry = raw.trim();
    const eq = entry.indexOf("=");
    const pattern = eq === -1 ? "" : entry.slice(0, eq).trim();
    const model = eq === -1 ? "" : entry.slice(eq + 1).trim();
    if (pattern === "" || model === "") {
      throw new ConfigurationError(
        `MODEL_MAP entry "${entry}" must be glob=model`,
      );
    }
    return { pattern, model };
  });
}

/** First matching rule wins; no match leaves the model unchanged. */
export function applyModelMap(model: string, rules: ModelMapRule[]): string {
  for (const rule of rules) {
    if (globMatch(rule.pattern, model)) return rule.model;
  }
  return model;
}
