/**
 * End-to-end tests in Chromium, Firefox and WebKit against the production build.
 *
 * Browsers come from `playwright install`. Where that isn't possible (e.g. a sandbox without
 * access to Playwright's CDN), point PW_CHROMIUM_PATH at a local Chromium and run
 * `pnpm e2e --project=chromium`.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = !!process.env['CI'];
const chromiumPath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Let keyboard-started playback begin without a click first.
        launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0 } },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
