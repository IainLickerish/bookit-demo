import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.BOOKIT_E2E_PORT ?? 4199);

export default defineConfig({
  testDir: 'tests/e2e',
  // One server, one database and one virtual clock: tests run in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: 'test-results/playwright/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/playwright/results.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
