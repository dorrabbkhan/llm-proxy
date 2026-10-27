import type { CanonicalError } from "../types/canonical.types";
import { kindFromStatus, makeCanonicalError } from "./canonical-error";

export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "PROXY_ERROR",
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /** Canonical form used to render this error in the client's dialect. */
  toCanonical(): CanonicalError {
    return makeCanonicalError(kindFromStatus(this.statusCode), this.message);
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        status: this.statusCode,
        ...(process.env.NODE_ENV !== "production" && this.context
          ? { details: this.context }
          : {}),
      },
    };
  }
}

export class ValidationError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 400, "VALIDATION_ERROR", context);
  }
}

export class TransformError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 500, "TRANSFORM_ERROR", context);
  }
}

export class UpstreamError extends ProxyError {
  /**
   * Client-facing rendering computed by proxy.service's upstream mapping
   * (spec §3.3). When set it wins over the default status-derived kind.
   */
  public clientError?: CanonicalError;
  /** Seconds from the upstream Retry-After header (set on 429/503). */
  public retryAfterSeconds?: number;

  constructor(
    message: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamBody?: unknown,
    context?: Record<string, unknown>,
    statusCode: number = 502,
  ) {
    // upstreamBody stays a field (for the §3.3 log summary) but is kept
    // out of `context`: context is serialized into non-production
    // `details` and an upstream body may echo keys or completion text.
    super(message, statusCode, "UPSTREAM_ERROR", {
      ...context,
      upstreamStatus,
    });
  }

  toCanonical(): CanonicalError {
    return this.clientError ?? super.toCanonical();
  }
}

export class AuthError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 401, "UNAUTHORIZED", context);
  }
}

export class ConfigurationError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 500, "CONFIGURATION_ERROR", context);
  }
}
