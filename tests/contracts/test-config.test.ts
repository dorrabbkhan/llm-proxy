import { describe, it, expect } from 'vitest';
import defaultConfig from '../../vitest.config';
import liveConfig from '../../vitest.live.config';

/**
 * Guards the suite layout: `npm test` must never pick up the live
 * suite (no network in npm test), and the live config must only
 * pick up tests/live/*.live.test.ts with a timeout generous enough
 * for real upstream calls.
 */
describe('test configuration', () => {
  it('npm test excludes the live suite', () => {
    expect(defaultConfig.test?.exclude).toContain('tests/live/**');
  });

  it('live config only includes live tests', () => {
    expect(liveConfig.test?.include).toEqual(['tests/live/**/*.live.test.ts']);
    expect(liveConfig.test?.testTimeout).toBeGreaterThanOrEqual(120000);
  });
});
