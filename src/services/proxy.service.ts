import { getConfig, type Config } from "../config/env-config";
import {
  adapters,
  PROVIDER_ROUTES,
  type Provider,
  type ProviderRoute,
} from "../transformers";
import { postJson, getJson } from "./http-client";
import {
  canonicalModelListSchema,
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
  method: string,
  body: unknown,
  requestId: string,
): Promise<ProxyResult | null> {
  // Cheap pre-check: only recognized provider API paths are proxied.
  const isProviderPath = Object.values(PROVIDER_ROUTES)
    .flat()
    .some((r) => r.method === method && path.startsWith(r.pathPrefix));
  if (!isProviderPath) return null;

  const config = getConfig();
  const sourceApi = config.sourceApi;
  const targetApi = config.targetApi;

  // Match the incoming path to a route on the configured source provider
  const route = PROVIDER_ROUTES[sourceApi].find(
    (r) => r.method === method && path.startsWith(r.pathPrefix),
  );
  if (!route) return null;

  if (route.kind === "models") {
    return proxyModelList(route, config, sourceApi, targetApi, requestId);
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

  // The model comes from the source path when the provider puts it there
  // (Gemini), otherwise from the canonical request.
  const model = route.modelFromPath?.(path) ?? parsed.data.model;
  parsed.data.model = model;

  const targetBody = adapters[targetApi].fromCanonicalRequest(parsed.data);

  const targetRoute = PROVIDER_ROUTES[targetApi].find(
    (r) => r.kind === "chat",
  )!;
  const url = `${config.targetBaseUrl}${targetRoute.requestPath(model)}`;

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

  logger.info(
    {
      requestId,
      sourceApi,
      targetApi,
      model,
      inputTokens: canonicalResp.usage?.inputTokens,
      outputTokens: canonicalResp.usage?.outputTokens,
      finishReason: canonicalResp.finishReason,
      upstreamDurationMs: upstream.durationMs,
    },
    "Request completed",
  );

  const sourceBody = adapters[sourceApi].fromCanonicalResponse(canonicalResp);

  return { body: sourceBody };
}

/**
 * GET /models flow — no request body, response transforms through
 * canonical like chat does.
 */
async function proxyModelList(
  route: ProviderRoute,
  config: Config,
  sourceApi: Provider,
  targetApi: Provider,
  requestId: string,
): Promise<ProxyResult> {
  const targetRoute = PROVIDER_ROUTES[targetApi].find(
    (r) => r.kind === "models",
  )!;
  const url = `${config.targetBaseUrl}${targetRoute.requestPath()}`;

  logger.info(
    { requestId, sourceApi, targetApi, url },
    "Forwarding models list request to upstream",
  );

  const upstream = await getJson({
    url,
    headers: buildAuthHeaders(targetApi, config.targetApiKey),
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

  const canonical = adapters[targetApi].toCanonicalModelList(upstream.body);

  if (process.env.NODE_ENV !== "production") {
    const parsed = canonicalModelListSchema.safeParse(canonical);
    if (!parsed.success) {
      logger.error(
        { requestId, issues: parsed.error.issues },
        "Canonical model list failed schema validation — adapter bug",
      );
    }
  }

  logger.info(
    { requestId, sourceApi, targetApi, modelCount: canonical.models.length },
    "Models list completed",
  );

  const sourceBody = adapters[sourceApi].fromCanonicalModelList(canonical);
  return { body: sourceBody };
}

export { TransformError };
