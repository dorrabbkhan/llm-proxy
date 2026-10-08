import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConfig } from "../config/env-config";
import {
  transformRequest,
  transformResponse,
  PROVIDER_PATHS,
  type Provider,
} from "../transformers";
import { TransformError, UpstreamError } from "../utils/errors";
import { logger } from "../utils/logger";

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

async function proxyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requestId = req.id;
  try {
    // Cheap pre-check: only recognized provider API paths are proxied.
    // Everything else falls through to the 404 handler without needing
    // config/env vars at all.
    const isProviderPath = Object.values(PROVIDER_PATHS).some((p) =>
      req.path.startsWith(p.pathPrefix),
    );
    if (!isProviderPath) {
      return next();
    }

    const config = getConfig();
    const sourceApi = config.sourceApi;
    const targetApi = config.targetApi;

    // The path belongs to some provider's API — but only serve it if
    // it's the configured source provider's path.
    if (!req.path.startsWith(PROVIDER_PATHS[sourceApi].pathPrefix)) {
      return next();
    }

    // Source → Canonical → Target
    const targetBody = transformRequest(sourceApi, targetApi, req.body);

    const model =
      typeof req.body?.model === "string" ? req.body.model : "default";
    const url = `${config.targetBaseUrl}${PROVIDER_PATHS[targetApi].requestPath(model)}`;

    logger.info(
      { requestId, sourceApi, targetApi, url },
      "Forwarding request to upstream",
    );

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(targetApi, config.targetApiKey),
      },
      body: JSON.stringify(targetBody),
    });

    const upstreamBody = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      throw new UpstreamError(
        `Upstream ${targetApi} returned ${upstream.status}`,
        upstream.status,
        upstreamBody,
      );
    }

    // Target → Canonical → Source
    const sourceBody = transformResponse(
      sourceApi,
      targetApi,
      upstreamBody,
      model,
    );

    res.status(200).json(sourceBody);
  } catch (err) {
    if (err instanceof UpstreamError || err instanceof TransformError) {
      return next(err);
    }
    next(
      new TransformError(
        err instanceof Error ? err.message : "Unknown transform error",
        { requestId },
      ),
    );
  }
}

export const proxyRouter = Router();
// Matches all paths; handler calls next() when the path doesn't belong
// to the configured source provider (falls through to 404).
proxyRouter.use(proxyHandler);
