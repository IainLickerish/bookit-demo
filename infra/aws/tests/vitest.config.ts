import { defineConfig } from 'vitest/config';

// Infrastructure checks for M0-34a. They need terraform, tflint and Docker, so they run on their own:
// bun x vitest run --config infra/aws/tests/vitest.config.ts
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 600_000,
    passWithNoTests: false,
  },
});
