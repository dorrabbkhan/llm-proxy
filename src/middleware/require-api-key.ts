import { timingSafeEqual } from "crypto";
import { RequestHandler } from "express";
import { AuthError } from "../utils/errors";

/**
 * Timing-safe string comparison — returns false for length mismatches
 * without leaking length via early exit.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Client-facing auth for proxied endpoints.
 *
 * Enabled only when PROXY_API_KEY is set — unset means auth disabled
 * (localhost/dev stays frictionless). Accepts OpenAI-style
 * `Authorization: Bearer <key>` so client SDKs work unchanged.
 *
 * Applied after /health in app.ts so health probes stay open.
 */
export function requireApiKey(apiKey: string | undefined): RequestHandler {
  // Auth disabled — pass everything through
  if (!apiKey) {
    return (_req, _res, next) => next();
  }

  return (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : undefined;

    if (!token || !safeEqual(token, apiKey)) {
      return next(
        new AuthError("Invalid or missing API key", { requestId: req.id })
      );
    }

    next();
  };
}
