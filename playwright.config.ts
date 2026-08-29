import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --config app/frontend/vite.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:3000/dashboard/agent',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-393', use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  ],
});
