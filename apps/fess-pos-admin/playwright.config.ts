import { defineConfig, devices } from '@playwright/test';

// E2E tests run against the dev server on :3000 (started automatically unless one is already running).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // the dev server compiles each route on first hit; allow for it before a redirect or first paint
  expect: { timeout: 20_000 },
  // Serial: every spec hits one on-demand-compiling dev server; parallel cold loads starve it and stall the auth gate.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  // E2E_BROWSER_CHANNEL=chrome uses the locally installed Google Chrome (when Playwright's own browsers can't be
  // downloaded); unset = Playwright's bundled Chromium (CI).
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}) },
  }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/sign-in',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
