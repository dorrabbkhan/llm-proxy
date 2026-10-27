import type {
  CanonicalError,
  CanonicalErrorKind,
} from "../types/canonical.types";

/** HTTP status the client sees for each canonical kind (spec §3.3). */
export const CANONICAL_ERROR_STATUS: Record<CanonicalErrorKind, number> = {
  invalid_request: 400,
  authentication: 401,
  permission: 403,
  not_found: 404,
  request_too_large: 413,
  rate_limit: 429,
  internal: 500,
  unsupported: 501,
  upstream: 502,
  unavailable: 503,
  timeout: 504,
};

/** Map an HTTP status to the canonical kind (spec §3.3). */
export function kindFromStatus(status: number): CanonicalErrorKind {
  switch (status) {
    case 400:
    case 422:
      return "invalid_request";
    case 401:
      return "authentication";
    case 403:
      return "permission";
    case 404:
      return "not_found";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limit";
    case 500:
      return "internal";
    case 501:
      return "unsupported";
    case 503:
    case 529:
      return "unavailable";
    case 504:
      return "timeout";
    default:
      if (status >= 500) return "upstream";
      if (status >= 400) return "invalid_request";
      return "internal";
  }
}

export function makeCanonicalError(
  kind: CanonicalErrorKind,
  message: string,
  retryAfterSeconds?: number,
): CanonicalError {
  return {
    kind,
    status: CANONICAL_ERROR_STATUS[kind],
    message,
    ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
  };
}
