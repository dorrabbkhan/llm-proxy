import { UpstreamError } from "../utils/errors";
import { logger } from "../utils/logger";

export interface UpstreamRequestOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
  retries?: number;
  requestId?: string;
}

export interface UpstreamResponse {
  status: number;
  body: unknown;
  durationMs: number;
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
 * POST JSON to an upstream provider with timeout + conservative retry.
 *
 * Retry policy: LLM POSTs aren't idempotent — retrying a request the
 * upstream may have already processed can double-bill tokens. So we only
 * retry transport failures (connection refused, DNS, socket reset) and
 * 429/503 where the upstream rejected before processing. Never retry other
 * statuses or timeouts (a partial generation may have run).
 */
export async function postJson(
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
          ...(requestId ? { "x-request-id": requestId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const durationMs = Date.now() - start;
      const parsed = await res.json().catch(() => null);

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

      return { status: res.status, body: parsed, durationMs };
    } catch (err) {
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
