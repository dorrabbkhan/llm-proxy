import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // The live suite hits real upstreams; `npm test` must stay offline.
    // Run it explicitly with `npm run test:live`.
    // scripts/gates/fixtures/ holds the Claude Code gate's intentionally
    // failing edit-task project — it is not a vitest suite.
    exclude: [
      ...configDefaults.exclude,
      'tests/live/**',
      'scripts/gates/fixtures/**',
    ],
  },
});
