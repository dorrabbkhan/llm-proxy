import type { RouteTarget } from "./plan-route";

/** `*` matches any run of characters; every other character is literal. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Glob test used by routing rules — the matcher moved here unchanged
 * from utils/model-map.ts (spec §3.3: `*` matches any run of
 * characters; everything else is literal).
 */
export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/**
 * `provider/model` → {provider, model} (spec §3.3): splits on the
 * first `/` only, and only when the prefix is a registered provider
 * name (case-sensitive) and the rest is non-empty — model names may
 * contain `/` and `:`. Anything else is not a target.
 */
export function parseTarget(
  text: string,
  providerNames: ReadonlySet<string>,
): RouteTarget | undefined {
  const slash = text.indexOf("/");
  if (slash === -1) return undefined;
  const provider = text.slice(0, slash);
  const model = text.slice(slash + 1);
  if (model === "" || !providerNames.has(provider)) return undefined;
  return { provider, model };
}
