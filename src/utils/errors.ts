export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'PROXY_ERROR',
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        status: this.statusCode,
        ...(process.env.NODE_ENV !== 'production' && this.context
          ? { details: this.context }
          : {}),
      },
    };
  }
}

export class ValidationError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', context);
  }
}

export class TransformError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 500, 'TRANSFORM_ERROR', context);
  }
}

export class UpstreamError extends ProxyError {
  constructor(
    message: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, 502, 'UPSTREAM_ERROR', {
      ...context,
      upstreamStatus,
      upstreamBody,
    });
  }
}

export class ConfigurationError extends ProxyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 500, 'CONFIGURATION_ERROR', context);
  }
}
