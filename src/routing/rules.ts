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
