import { describe, it, expect, vi } from 'vitest';
import { extractClientKeys, requireApiKey } from './require-api-key';
import { AuthError } from '../utils/errors';
import type { Request, Response } from 'express';

function fakeReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    id: 'req-1',
  } as unknown as Request;
}

function fakeReqFull(opts: {
  authorization?: string;
  xApiKey?: string;
  xGoogApiKey?: string;
  key?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  if (opts.xApiKey !== undefined) headers['x-api-key'] = opts.xApiKey;
  if (opts.xGoogApiKey !== undefined) headers['x-goog-api-key'] = opts.xGoogApiKey;
  return {
    headers,
    query: opts.key !== undefined ? { key: opts.key } : {},
    id: 'req-1',
  } as unknown as Request;
}

describe('requireApiKey', () => {
  it('passes through when no key configured (auth disabled)', () => {
    const mw = requireApiKey(undefined);
    const next = vi.fn();
    mw(fakeReq(), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with 401 when Authorization header is missing', () => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(fakeReq(), {} as Response, next);

    const err = next.mock.calls[0]![0] as AuthError;
    expect(err).toBeInstanceOf(AuthError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong key', () => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(fakeReq('Bearer wrong-key'), {} as Response, next);

    expect(next.mock.calls[0]![0]).toBeInstanceOf(AuthError);
  });

  it('rejects non-Bearer scheme', () => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(fakeReq('Basic c2VjcmV0'), {} as Response, next);

    expect(next.mock.calls[0]![0]).toBeInstanceOf(AuthError);
  });

  it('rejects key with correct prefix but different length', () => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(fakeReq('Bearer secret'), {} as Response, next);

    expect(next.mock.calls[0]![0]).toBeInstanceOf(AuthError);
  });

  it('passes through with valid Bearer key', () => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(fakeReq('Bearer secret-key'), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('client auth in native headers (spec §3.4)', () => {
  const styles: { style: string; req: (key: string) => Request }[] = [
    {
      style: 'Authorization: Bearer',
      req: (key) => fakeReqFull({ authorization: `Bearer ${key}` }),
    },
    {
      style: 'x-api-key',
      req: (key) => fakeReqFull({ xApiKey: key }),
    },
    {
      style: 'x-goog-api-key',
      req: (key) => fakeReqFull({ xGoogApiKey: key }),
    },
    {
      style: '?key= query parameter',
      req: (key) => fakeReqFull({ key }),
    },
  ];

  it.each(styles)('accepts the key via $style', ({ req }) => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(req('secret-key'), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it.each(styles)('rejects a wrong key via $style', ({ req }) => {
    const mw = requireApiKey('secret-key');
    const next = vi.fn();
    mw(req('wrong-key'), {} as Response, next);

    const err = next.mock.calls[0]![0] as AuthError;
    expect(err).toBeInstanceOf(AuthError);
    expect(err.statusCode).toBe(401);
  });

  describe('auth edge cases', () => {
    it('rejects "Bearer " with an empty token', () => {
      const mw = requireApiKey('secret-key');
      const next = vi.fn();
      mw(fakeReq('Bearer '), {} as Response, next);

      expect(next.mock.calls[0]![0]).toBeInstanceOf(AuthError);
    });

    it('rejects "?key=" with an empty value', () => {
      const mw = requireApiKey('secret-key');
      const next = vi.fn();
      mw(fakeReqFull({ key: '' }), {} as Response, next);

      expect(next.mock.calls[0]![0]).toBeInstanceOf(AuthError);
    });

    it('accepts when Authorization is wrong but x-api-key matches', () => {
      const mw = requireApiKey('secret-key');
      const next = vi.fn();
      mw(
        fakeReqFull({ authorization: 'Bearer wrong-key', xApiKey: 'secret-key' }),
        {} as Response,
        next,
      );

      expect(next).toHaveBeenCalledWith();
    });

    it('accepts lowercase "bearer <key>"', () => {
      const mw = requireApiKey('secret-key');
      const next = vi.fn();
      mw(fakeReq('bearer secret-key'), {} as Response, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('extractClientKeys', () => {
    it('collects every non-empty candidate', () => {
      const req = fakeReqFull({
        authorization: 'Bearer k1',
        xApiKey: 'k2',
        xGoogApiKey: 'k3',
        key: 'k4',
      });

      expect(extractClientKeys(req)).toEqual(['k1', 'k2', 'k3', 'k4']);
    });

    it('skips empty candidates', () => {
      expect(
        extractClientKeys(fakeReqFull({ authorization: 'Bearer ', key: '' })),
      ).toEqual([]);
      expect(extractClientKeys(fakeReq())).toEqual([]);
    });
  });
});
