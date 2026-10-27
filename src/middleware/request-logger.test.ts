import { describe, it, expect } from 'vitest';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { createRequestLogger, requestLogger } from './request-logger';

// A real pino instance writing to a captured stream, so every assertion
// runs against pino's actual serialisation — not a mocked req object.
function testApp() {
  const lines: string[] = [];
  const stream = {
    write: (chunk: string) => {
      lines.push(chunk);
    },
  };
  const app = express();
  app.use(createRequestLogger(pino({ level: 'info' }, stream)));
  app.use((_req, res) => {
    res.json({ ok: true });
  });
  return {
    app,
    output: () => lines.join(''),
  };
}

describe('requestLogger', () => {
  it('should export a middleware function', () => {
    expect(requestLogger).toBeDefined();
    expect(typeof requestLogger).toBe('function');
  });

  it('should have correct arity for Express middleware', () => {
    expect(requestLogger.length).toBe(3);
  });

  it('credential headers never reach the request log', async () => {
    const { app, output } = testApp();

    await request(app)
      .get('/v1/chat/completions')
      .set('authorization', 'Bearer sk-secret-1')
      .set('x-api-key', 'sk-secret-2')
      .set('x-goog-api-key', 'sk-secret-3')
      .expect(200);

    expect(output()).not.toContain('sk-secret');
    expect(output()).toContain('[REDACTED]');
  });

  it('?key= is redacted from the logged url', async () => {
    const { app, output } = testApp();

    await request(app)
      .get('/v1beta/models?key=sk-secret-4&pageSize=5')
      .expect(200);

    expect(output()).not.toContain('sk-secret-4');
    expect(output()).toContain('key=[REDACTED]');
    expect(output()).toContain('pageSize=5');
  });

  it('non-credential headers are still logged', async () => {
    const { app, output } = testApp();

    await request(app)
      .get('/v1/models')
      .set('user-agent', 'vitest-agent/1.0')
      .expect(200);

    expect(output()).toContain('vitest-agent/1.0');
  });
});
