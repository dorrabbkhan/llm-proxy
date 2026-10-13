import { describe, it, expect, vi } from 'vitest';
import { requireApiKey } from './require-api-key';
import { AuthError } from '../utils/errors';
import type { Request, Response } from 'express';

function fakeReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
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
