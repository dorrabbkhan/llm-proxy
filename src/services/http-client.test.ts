import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJson } from './http-client';
import { UpstreamError } from '../utils/errors';

const OPTS = {
  url: 'http://upstream.test/api',
  headers: { 'x-test': 'yes' },
  body: { hello: 'world' },
  requestId: 'req-123',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postJson', () => {
  it('returns status, parsed body, and durationMs on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    );

    const res = await postJson(OPTS);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('network error throws UpstreamError 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    );

    const err = await postJson({ ...OPTS, retries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.statusCode).toBe(502);
  });

  it('timeout throws UpstreamError 504 and never retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException('The operation timed out', 'TimeoutError')
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await postJson({ ...OPTS, timeoutMs: 50, retries: 3 }).catch(
      (e) => e
    );

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.statusCode).toBe(504);
    expect(err.message).toContain('timed out');
    // Never retried — a partial generation may have run upstream
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 retries once then throws UpstreamError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await postJson({ ...OPTS, retries: 1 }).catch((e) => e);

    expect(err).toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('503 retries then succeeds on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await postJson({ ...OPTS, retries: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('500 is returned to caller without retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await postJson({ ...OPTS, retries: 1 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('non-JSON body returns null body with status preserved', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('not json', { status: 418 })
        )
    );

    const res = await postJson(OPTS);

    expect(res.status).toBe(418);
    expect(res.body).toBeNull();
  });

  it('forwards x-request-id to upstream headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await postJson(OPTS);

    const callHeaders = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(callHeaders['x-request-id']).toBe('req-123');
  });

  it('transport failure retries then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('socket reset'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await postJson({ ...OPTS, retries: 1 });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
