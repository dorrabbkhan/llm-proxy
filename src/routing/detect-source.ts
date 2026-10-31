import { PROVIDER_ROUTES, type Provider } from "../transformers/adapters";

/**
 * Pure request → client-format detection (spec §3.2): the request's
 * method + path prefix selects the provider whose dialect the client
 * speaks, over the same PROVIDER_ROUTES table the services match on.
 *
 * The only ambiguous route is `GET /v1/models`, shared by openai and
 * anthropic. Anthropic SDKs always send `anthropic-version`
 * (@anthropic-ai/sdk client.js:842 — unconditional default header).
 * Claude Code model discovery does not: its gateway docs ("Model
 * discovery → Request and response",
 * https://code.claude.com/docs/en/llm-gateway-protocol) show
 * `GET /v1/models?limit=1000` carrying `Authorization`, `x-api-key` and
 * `ANTHROPIC_CUSTOM_HEADERS` — Claude Code ≥ 2.1.248 sends both
 * credential headers. Either `anthropic-version` or `x-api-key` marks
 * the client as anthropic; OpenAI SDKs authenticate with
 * `Authorization: Bearer` alone, so neither header → openai.
 * `headers` are the request's own (Node lowercases the names).
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
  const headerNames = new Set(
    Object.keys(headers).map((name) => name.toLowerCase()),
  );
  const anthropicClient =
    headerNames.has("anthropic-version") || headerNames.has("x-api-key");
  if (anthropicClient && matches.includes("anthropic")) {
    return "anthropic";
  }
  return matches[0];
}
