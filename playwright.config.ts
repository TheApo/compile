import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,  // 60 Sekunden pro Test
  expect: {
    timeout: 10000,  // 10 Sekunden für expects
  },
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,  // Sichtbar für Debugging
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
  // Nur Chromium für jetzt
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
