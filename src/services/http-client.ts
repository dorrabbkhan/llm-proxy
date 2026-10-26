import { UpstreamError } from "../utils/errors";
import { logger } from "../utils/logger";

export interface UpstreamRequestOptions {
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  requestId?: string;
}

export interface UpstreamResponse {
  status: number;
  body: unknown;
  durationMs: number;
  contentType?: string;
}

/** Retry only these upstream statuses — upstream rejected before processing */
const RETRYABLE_STATUSES = new Set([429, 503]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const BASE_BACKOFF_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter: ~250ms, ~500ms, ... */
function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt);
  return base + Math.floor(Math.random() * base * 0.5);
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * Send a JSON request to an upstream provider with timeout + conservative
 * retry. postJson/getJson are thin wrappers.
 *
 * Retry policy: LLM POSTs aren't idempotent — retrying a request the
 * upstream may have already processed can double-bill tokens. So we only
 * retry transport failures (connection refused, DNS, socket reset) and
 * 429/503 where the upstream rejected before processing. Never retry other
 * statuses or timeouts (a partial generation may have run). GETs are
 * idempotent but follow the same policy for simplicity.
 */
export async function requestJson(
  method: "GET" | "POST",
  opts: UpstreamRequestOptions,
): Promise<UpstreamResponse> {
  const {
    url,
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    requestId,
  } = opts;

  const maxAttempts = retries + 1;
  let lastError: UpstreamError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
          ...(requestId ? { "x-request-id": requestId } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const durationMs = Date.now() - start;
      const contentType = res.headers.get("content-type") ?? "unknown";
      const text = await res.text();
      let parsed: unknown = null;
      let parseFailed = false;
      try {
        parsed = JSON.parse(text);
      } catch {
        parseFailed = true;
      }

      logger.info(
        {
          requestId,
          url,
          attempt: attempt + 1,
          durationMs,
          status: res.status,
        },
        "Upstream request",
      );

      // Retryable rejection (429/503): upstream declined before processing
      if (RETRYABLE_STATUSES.has(res.status)) {
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new UpstreamError(
          `Upstream rejected request after ${maxAttempts} attempts`,
          res.status,
          parsed,
          { requestId, url, attempts: maxAttempts },
        );
      }

      // A 2xx that isn't valid JSON is an upstream failure (e.g. Ollama
      // answering with NDJSON), not a successful empty response.
      if (res.ok && parseFailed) {
        throw new UpstreamError(
          `Upstream returned a non-JSON response (content-type: ${contentType})`,
          res.status,
          undefined,
          {
            requestId,
            url,
            // error-handler logs err.context in every environment, so the
            // body preview (completion text for NDJSON) is dev-only
            ...(process.env.NODE_ENV !== "production"
              ? { bodyPreview: text.slice(0, 200) }
              : {}),
          },
        );
      }

      return {
        status: res.status,
        body: parseFailed ? null : parsed,
        durationMs,
        contentType,
      };
    } catch (err) {
      // Our own UpstreamErrors (non-JSON 2xx, retries exhausted) propagate.
      if (err instanceof UpstreamError) throw err;

      const durationMs = Date.now() - start;

      // Timeout: never retry — upstream may have partially processed
      if (isAbortError(err)) {
        throw new UpstreamError(
          `Upstream timed out after ${timeoutMs}ms`,
          undefined,
          undefined,
          { requestId, url, durationMs },
          504,
        );
      }

      // Transport failure: safe to retry — upstream likely never saw it
      lastError = new UpstreamError(
        `Upstream unreachable: ${err instanceof Error ? err.message : "connection failed"}`,
        undefined,
        undefined,
        { requestId, url, attempt: attempt + 1, durationMs },
      );

      if (attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }

  throw lastError ?? new UpstreamError("Upstream request failed");
}

export function postJson(
  opts: UpstreamRequestOptions,
): Promise<UpstreamResponse> {
  return requestJson("POST", opts);
}

export function getJson(
  opts: UpstreamRequestOptions,
): Promise<UpstreamResponse> {
  return requestJson("GET", opts);
}
