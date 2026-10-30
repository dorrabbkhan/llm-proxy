import { PROVIDER_ROUTES, type Provider } from "../transformers/adapters";

/**
 * Pure request → client-format detection (spec §3.2): the request's
 * method + path prefix selects the provider whose dialect the client
 * speaks, over the same PROVIDER_ROUTES table the services match on.
 *
 * The only ambiguous route is `GET /v1/models`, shared by openai and
 * anthropic. Anthropic SDKs and Claude Code always send
 * `anthropic-version` (@anthropic-ai/sdk client.js:842 — unconditional
 * default header), so its presence selects anthropic and its absence
 * openai. `headers` are the request's own (Node lowercases the names).
 */
export function detectSource(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
): Provider | undefined {
  const matches = (Object.keys(PROVIDER_ROUTES) as Provider[]).filter(
    (provider) =>
      PROVIDER_ROUTES[provider].some(
        (r) => r.method === method && path.startsWith(r.pathPrefix),
      ),
  );
  if (matches.length === 0) return undefined;
  const anthropicVersion = Object.keys(headers).some(
    (name) => name.toLowerCase() === "anthropic-version",
  );
  if (anthropicVersion && matches.includes("anthropic")) {
    return "anthropic";
  }
  return matches[0];
}
