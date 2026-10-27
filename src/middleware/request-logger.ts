import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import type { SerializedRequest } from 'pino-std-serializers';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

// Header names that can carry a client credential; their values never
// reach a log line (Node lowercases inbound header names).
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
]);

// A Gemini-style `?key=` credential can sit anywhere in the query string;
// every other parameter is logged as it is.
function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/([?&]key=)[^&]*/g, '$1[REDACTED]');
}

// pino-http feeds the standard-serialized req through this before each
// line is written — the last chance to strip credentials.
function serializeReq(req: SerializedRequest): SerializedRequest {
  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (CREDENTIAL_HEADERS.has(name.toLowerCase())) {
      headers[name] = '[REDACTED]';
    }
  }
  req.headers = headers;
  req.url = redactUrl(req.url) as string;
  // Express parses the query onto req.query, so `key` would survive the
  // url redaction above; blank the parsed value too.
  if (req.query && typeof req.query === 'object' && 'key' in req.query) {
    req.query = { ...req.query, key: '[REDACTED]' };
  }
  return req;
}

export function createRequestLogger(log: Logger) {
  return pinoHttp({
    logger: log,
    genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: { req: serializeReq },
    customSuccessMessage: (req, res) => {
      return `${req.method} ${redactUrl(req.url)} ${res.statusCode}`;
    },
    customErrorMessage: (req, res) => {
      return `${req.method} ${redactUrl(req.url)} ${res.statusCode}`;
    },
    customProps: (req) => ({
      requestId: req.id,
    }),
  });
}

export const requestLogger = createRequestLogger(logger);

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
