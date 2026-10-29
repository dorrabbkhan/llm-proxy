import type { GatewayConfig } from "../config/env-config";
import {
  adapters,
  PROVIDER_ROUTES,
  type Provider,
  type ProviderRoute,
} from "../transformers";
import { authHeaders } from "../routing/registry";
import { canonicalModelListSchema } from "../types/canonical.schema";
import { UpstreamError } from "../utils/errors";
import { logger } from "../utils/logger";
import { getJson } from "./http-client";
import { toClientFacing } from "./attempt-targets";
import type { ProxyResult } from "./proxy.service";

/**
 * GET /models flow (moved from proxy.service): the default provider's
 * list, decoded through canonical and re-encoded in the client's
 * format. Task 6 merges every provider's list behind a 60 s cache.
 */
export async function proxyModelList(
  source: Provider,
  route: ProviderRoute,
  config: GatewayConfig,
  requestId: string,
): Promise<ProxyResult> {
  const entry = config.registry.get(config.routing.defaultProvider);
  const targetRoute = PROVIDER_ROUTES[entry.type].find(
    (r) => r.kind === "models",
  )!;
  const url = `${entry.baseUrl}${targetRoute.requestPath()}`;

  logger.info(
    { requestId, sourceApi: source, targetApi: entry.type, url },
    "Forwarding models list request to upstream",
  );

  const upstream = await getJson({
    url,
    headers: authHeaders(entry),
    timeoutMs: entry.timeoutMs ?? config.upstreamTimeoutMs,
    retries: config.upstreamRetries,
    requestId,
  }).catch((err) => {
    throw err instanceof UpstreamError
      ? toClientFacing(err, entry.type)
      : err;
  });

  if (upstream.status < 200 || upstream.status >= 300) {
    const err = new UpstreamError(
      `Upstream ${entry.type} returned ${upstream.status}`,
      upstream.status,
      upstream.body,
    );
    err.retryAfterSeconds = upstream.retryAfterSeconds;
    throw toClientFacing(err, entry.type);
  }

  const canonical = adapters[entry.type].toCanonicalModelList(
    upstream.body,
  );

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
    {
      requestId,
      sourceApi: source,
      targetApi: entry.type,
      modelCount: canonical.models.length,
    },
    "Models list completed",
  );

  return { body: adapters[source].fromCanonicalModelList(canonical) };
}
