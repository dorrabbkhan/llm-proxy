import { describe, it, expect } from 'vitest';
import { requestLogger } from './request-logger';

describe('requestLogger', () => {
  it('should export a middleware function', () => {
    expect(requestLogger).toBeDefined();
    expect(typeof requestLogger).toBe('function');
  });

  it('should have correct arity for Express middleware', () => {
    expect(requestLogger.length).toBe(3);
  });
});
