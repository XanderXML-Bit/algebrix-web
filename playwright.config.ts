import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  webServer: {
    command: 'npm run build && node scripts/serve-dist.mjs',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:4177',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
