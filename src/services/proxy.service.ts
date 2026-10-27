import { getConfig, type Config } from "../config/env-config";
import {
  adapters,
  PROVIDER_ROUTES,
  type Provider,
  type ProviderRoute,
} from "../transformers";
import { findSourceRoute } from "../transformers/adapters";
import { postJson, getJson, postStream } from "./http-client";
import { runStreamPipeline } from "./stream-pipeline";
import { toClientError } from "./upstream-errors";
import {
  canonicalModelListSchema,
  canonicalRequestSchema,
  canonicalResponseSchema,
} from "../types/canonical.schema";
import type {
  CanonicalRequest,
  CanonicalStreamEvent,
  StreamDecoder,
} from "../types/canonical.types";
import {
  NotSupportedError,
  TransformError,
  UpstreamError,
  ValidationError,
} from "../utils/errors";
import { logger } from "../utils/logger";

export interface ProxyResult {
  body?: unknown;
  headers?: Record<string, string>;
  stream?: {
    contentType: string;
    chunks: AsyncIterable<string>;
  };
}

export interface ProxyRequestOptions {
  /** Incoming query parameters (encoders may branch on them, §3.5) */
  query?: Record<string, string>;
  /** Client disconnect — aborts the upstream request */
  signal?: AbortSignal;
}

/**
 * Attach the spec §3.3 client-facing rendering to an upstream failure.
 * Only real upstream error statuses (≥ 400) go through the mapping
 * table — timeouts, transport failures and non-JSON 2xx replies already
 * carry their final client-facing message.
 */
function toClientFacing(err: UpstreamError, target: Provider): UpstreamError {
  if (err.upstreamStatus !== undefined && err.upstreamStatus >= 400) {
    err.clientError = toClientError(
      target,
      err.upstreamStatus,
      err.upstreamBody,
      err.retryAfterSeconds,
    );
  }
  return err;
}

/**
 * The "<method>" in a "/v1beta/models/<m>:<method>" path — the text
 * after the last ":" of the percent-decoded path, the same parsing the
 * route's isSupportedPath uses.
 */
function methodFromPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // malformed escapes — fall back to the raw path
  }
  const colon = decoded.lastIndexOf(":");
  return colon === -1 ? decoded : decoded.slice(colon + 1);
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
  opts?: ProxyRequestOptions,
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
  const route = findSourceRoute(sourceApi, method, path);
  if (!route) return null;

  if (route.kind === "models") {
    return proxyModelList(route, config, sourceApi, targetApi, requestId);
  }

  // Gemini paths carry a ":<method>" suffix — anything that isn't a
  // method this route serves is refused before conversion, before any
  // upstream call (spec §3.2, E11).
  if (route.isSupportedPath?.(path) === false) {
    throw new NotSupportedError(`${methodFromPath(path)} is not supported`);
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
  // (Gemini), otherwise from the canonical request. An explicitly empty
  // model in the path (e.g. /v1beta/models/:generateContent) is a client
  // error, not something to send upstream.
  const modelFromPath = route.modelFromPath?.(path);
  if (modelFromPath === "") {
    throw new ValidationError(
      `Malformed ${sourceApi} request path: model is empty`,
      { requestId },
    );
  }
  const model = modelFromPath ?? parsed.data.model;
  parsed.data.model = model;

  // Streaming (spec §3.2): a `stream` body flag on the JSON-body sources,
  // the dedicated streaming endpoint on Gemini — which carries no body
  // flag, so canonical.stream is set here for the target adapter's
  // own streaming marker (openai stream_options, anthropic/ollama
  // stream:true).
  if (parsed.data.stream === true || route.isStreamPath?.(path) === true) {
    parsed.data.stream = true;
    return proxyChatStream(
      parsed.data,
      body,
      model,
      config,
      sourceApi,
      targetApi,
      requestId,
      opts,
    );
  }

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
  }).catch((err) => {
    throw err instanceof UpstreamError
      ? toClientFacing(err, targetApi)
      : err;
  });

  if (upstream.status < 200 || upstream.status >= 300) {
    const err = new UpstreamError(
      `Upstream ${targetApi} returned ${upstream.status}`,
      upstream.status,
      upstream.body,
    );
    err.retryAfterSeconds = upstream.retryAfterSeconds;
    throw toClientFacing(err, targetApi);
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
 * Streaming chat flow (spec §3.2): target decoder + source encoder,
 * postStream for upstream bytes, runStreamPipeline for the pipe.
 * All four adapters stream since v1.1 Task 7 — the v1.0.1
 * streaming-refusal path is gone. A Gemini target uses the route's
 * streamRequestPath (`:streamGenerateContent?alt=sse`); the others
 * stream on the chat path.
 */
async function proxyChatStream(
  canonical: CanonicalRequest,
  sourceRequest: unknown,
  model: string,
  config: Config,
  sourceApi: Provider,
  targetApi: Provider,
  requestId: string,
  opts?: ProxyRequestOptions,
): Promise<ProxyResult> {
  const decoder = adapters[targetApi].createStreamDecoder(model);
  const encoder = adapters[sourceApi].createStreamEncoder({
    sourceRequest,
    query: opts?.query ?? {},
    requestedModel: model,
  });

  const targetBody = adapters[targetApi].fromCanonicalRequest(canonical);

  const targetRoute = PROVIDER_ROUTES[targetApi].find(
    (r) => r.kind === "chat",
  )!;
  const url = `${config.targetBaseUrl}${
    targetRoute.streamRequestPath?.(model) ?? targetRoute.requestPath(model)
  }`;

  logger.info(
    { requestId, sourceApi, targetApi, url, stream: true },
    "Forwarding request to upstream",
  );

  // Client disconnect aborts the upstream request; upstreamAc lets the
  // pipeline's end (terminal event, failure) tear it down too — a bare
  // body cancel doesn't reach the request on every transport.
  const upstreamAc = new AbortController();
  const upstream = await postStream({
    url,
    headers: buildAuthHeaders(targetApi, config.targetApiKey),
    body: targetBody,
    timeoutMs: config.upstreamTimeoutMs,
    retries: config.upstreamRetries,
    requestId,
    signal: opts?.signal
      ? AbortSignal.any([opts.signal, upstreamAc.signal])
      : upstreamAc.signal,
  }).catch((err) => {
    throw err instanceof UpstreamError
      ? toClientFacing(err, targetApi)
      : err;
  });

  // Watch the event stream for the completion log line — the pipeline
  // yields only encoded bytes, so the decoder is wrapped. Chunk contents
  // are never logged (§3.2); only usage and the finish reason are.
  const observed: CanonicalStreamEvent[] = [];
  const recordingDecoder: StreamDecoder = {
    feed(chunk) {
      const events = decoder.feed(chunk);
      observed.push(...events);
      return events;
    },
    end() {
      const events = decoder.end();
      observed.push(...events);
      return events;
    },
  };

  const signal = opts?.signal ?? new AbortController().signal;

  const chunks = (async function* (): AsyncGenerator<string> {
    try {
      yield* runStreamPipeline({
        upstream: upstream.body,
        decoder: recordingDecoder,
        encoder,
        idleMs: config.upstreamStreamIdleMs,
        signal,
      });
    } finally {
      // Whatever ended the pipe — terminal event, in-stream error,
      // client disconnect — the upstream request is done with.
      upstreamAc.abort();
    }
    const last = observed.at(-1);
    if (last?.type === "message_end") {
      const usageEvent = observed.find((e) => e.type === "usage");
      logger.info(
        {
          requestId,
          sourceApi,
          targetApi,
          model,
          stream: true,
          inputTokens:
            usageEvent?.type === "usage"
              ? usageEvent.usage.inputTokens
              : undefined,
          outputTokens:
            usageEvent?.type === "usage"
              ? usageEvent.usage.outputTokens
              : undefined,
          finishReason: last.finishReason,
          upstreamDurationMs: upstream.durationMs,
        },
        "Request completed",
      );
    }
  })();

  return { stream: { contentType: encoder.contentType, chunks } };
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
  }).catch((err) => {
    throw err instanceof UpstreamError
      ? toClientFacing(err, targetApi)
      : err;
  });

  if (upstream.status < 200 || upstream.status >= 300) {
    const err = new UpstreamError(
      `Upstream ${targetApi} returned ${upstream.status}`,
      upstream.status,
      upstream.body,
    );
    err.retryAfterSeconds = upstream.retryAfterSeconds;
    throw toClientFacing(err, targetApi);
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
