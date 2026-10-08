import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { errorHandler } from './error-handler';
import { ProxyError, ValidationError, UpstreamError } from '../utils/errors';

describe('errorHandler', () => {
  const originalEnv = process.env.NODE_ENV;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReq = { id: 'test-request-id' };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('ProxyError handling', () => {
    it('should return correct status for ValidationError', () => {
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            status: 400,
          }),
        })
      );
    });

    it('should return correct status for UpstreamError', () => {
      const error = new UpstreamError('API failed', 429);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'UPSTREAM_ERROR',
            status: 502,
          }),
        })
      );
    });
  });

  describe('unknown error handling', () => {
    it('should return 500 for unknown errors', () => {
      const error = new Error('Something broke');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INTERNAL_ERROR',
            status: 500,
          }),
        })
      );
    });

    it('should hide error details in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Secret internal error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      const response = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('Internal Server Error');
      expect(response.error.details).toBeUndefined();
    });

    it('should show error details in development', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Debug info');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      const response = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('Debug info');
      expect(response.error.details).toBeDefined();
    });
  });
});
