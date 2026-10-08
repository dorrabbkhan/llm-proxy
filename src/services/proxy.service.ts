import { getConfig } from "../config/env-config";
import { adapters, PROVIDER_PATHS, type Provider } from "../transformers";
import { postJson } from "./http-client";
import {
  canonicalRequestSchema,
  canonicalResponseSchema,
} from "../types/canonical.schema";
import {
  TransformError,
  UpstreamError,
  ValidationError,
} from "../utils/errors";
import { logger } from "../utils/logger";

export interface ProxyResult {
  body: unknown;
}

/**
 * Provider-specific auth headers.
 */
function buildAuthHeaders(
  provider: Provider,
  apiKey: string | undefined,
): Record<string, string> {
  if (!apiKey) return {};

  switch (provider) {
    case "openai":
      return { Authorization: `Bearer ${apiKey}` };
    case "anthropic":
      return {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
    case "gemini":
      return { "x-goog-api-key": apiKey };
    case "ollama":
      return {};
  }
}

/**
 * Full proxy orchestration:
 *   path match → config → canonical boundary validation →
 *   transform → upstream call → transform back.
 *
 * Returns null when the path doesn't belong to the configured source
 * provider (route should call next() → 404).
 * Throws ValidationError | UpstreamError | TransformError | ConfigurationError.
 */
export async function proxyRequest(
  path: string,
  body: unknown,
  requestId: string,
): Promise<ProxyResult | null> {
  // Cheap pre-check: only recognized provider API paths are proxied.
  const isProviderPath = Object.values(PROVIDER_PATHS).some((p) =>
    path.startsWith(p.pathPrefix),
  );
  if (!isProviderPath) return null;

  const config = getConfig();
  const sourceApi = config.sourceApi;
  const targetApi = config.targetApi;

  // Path is a provider API path but not the configured source's → 404
  if (!path.startsWith(PROVIDER_PATHS[sourceApi].pathPrefix)) {
    return null;
  }

  // Source → Canonical. The adapter may throw on malformed input —
  // that's a client error (400), not a server error (500).
  let canonical: ReturnType<(typeof adapters)[Provider]["toCanonicalRequest"]>;
  try {
    canonical = adapters[sourceApi].toCanonicalRequest(body);
  } catch (err) {
    throw new ValidationError(
      `Malformed ${sourceApi} request: ${err instanceof Error ? err.message : "invalid body"}`,
      { requestId },
    );
  }

  // Boundary validation: malformed client request → 400, not 500.
  const parsed = canonicalRequestSchema.safeParse(canonical);
  if (!parsed.success) {
    throw new ValidationError("Malformed request body", {
      requestId,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  const targetBody = adapters[targetApi].fromCanonicalRequest(parsed.data);

  const model =
    typeof (body as Record<string, unknown>)?.model === "string"
      ? ((body as Record<string, unknown>).model as string)
      : "default";
  const url = `${config.targetBaseUrl}${PROVIDER_PATHS[targetApi].requestPath(model)}`;

  logger.info(
    { requestId, sourceApi, targetApi, url },
    "Forwarding request to upstream",
  );

  const upstream = await postJson({
    url,
    headers: buildAuthHeaders(targetApi, config.targetApiKey),
    body: targetBody,
    timeoutMs: config.upstreamTimeoutMs,
    retries: config.upstreamRetries,
    requestId,
  });

  if (upstream.status < 200 || upstream.status >= 300) {
    throw new UpstreamError(
      `Upstream ${targetApi} returned ${upstream.status}`,
      upstream.status,
      upstream.body,
    );
  }

  // Target → Canonical → Source
  const canonicalResp = adapters[targetApi].toCanonicalResponse(
    upstream.body,
    model,
  );

  // Adapter bug detection (non-production only): canonical response
  // should always be schema-valid
  if (process.env.NODE_ENV !== "production") {
    const respParsed = canonicalResponseSchema.safeParse(canonicalResp);
    if (!respParsed.success) {
      logger.error(
        { requestId, issues: respParsed.error.issues },
        "Canonical response failed schema validation — adapter bug",
      );
    }
  }

  const sourceBody = adapters[sourceApi].fromCanonicalResponse(canonicalResp);

  return { body: sourceBody };
}

export { TransformError };
