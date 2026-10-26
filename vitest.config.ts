import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // The live suite hits real upstreams; `npm test` must stay offline.
    // Run it explicitly with `npm run test:live`.
    exclude: [...configDefaults.exclude, 'tests/live/**'],
  },
});
