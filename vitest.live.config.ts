import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.test.ts'],
    // Real upstream calls — a small local model on CPU can take a while.
    testTimeout: 120000,
  },
});
