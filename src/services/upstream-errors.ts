import { adapters, type Provider } from "../transformers";
import type { CanonicalError } from "../types/canonical.types";
import { makeCanonicalError } from "../utils/canonical-error";

/**
 * The spec §3.3 upstream → client mapping, applied row by row.
 *
 * The *target* adapter parses the upstream body for its kind and message
 * (`toCanonicalError` never throws; unrecognised bodies get the fallback
 * message). This function then decides what the client sees:
 *
 * - authentication/permission → 502 "upstream" with the credentials
 *   message (D1: the upstream rejected the *proxy's* key — a 401 would
 *   wrongly tell the client its own key is bad). Decided on the parsed
 *   kind, not the raw status, because e.g. Gemini reports a bad key as
 *   400 + API_KEY_INVALID.
 * - 400/422 → 400 invalid_request, 404 → not_found, 413 →
 *   request_too_large, 429 → rate_limit, 503/529 → unavailable — the
 *   message passes through, `Retry-After` too when present.
 * - every other 5xx → 502 upstream (kindFromStatus calls a bare 500
 *   "internal", but for the client it is an upstream condition, not a
 *   proxy bug).
 */
export function toClientError(
  target: Provider,
  upstreamStatus: number,
  upstreamBody: unknown,
  retryAfterSeconds?: number,
): CanonicalError {
  const upstream = adapters[target].toCanonicalError(
    upstreamStatus,
    upstreamBody,
  );

  if (upstream.kind === "authentication" || upstream.kind === "permission") {
    return makeCanonicalError(
      "upstream",
      `Upstream ${target} rejected the proxy's credentials (${upstreamStatus})`,
    );
  }

  const kind =
    upstreamStatus >= 500 && upstream.kind !== "unavailable"
      ? "upstream"
      : upstream.kind;

  return makeCanonicalError(kind, upstream.message, retryAfterSeconds);
}
