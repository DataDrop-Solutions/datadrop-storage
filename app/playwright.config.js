import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'https://app.datadrop.co.in',
    screenshot: 'on',
    video: 'on',
    trace: 'on',
    headless: false,
  },
  timeout: 120000,
  projects: [
    // Auth setup — runs once, saves session to tests/.auth/user.json
    // NOTE: Because the test account uses Google OAuth,
    // this requires running HEADED and logging in manually via Google.
    // Run: npx playwright test tests/auth.setup.js --headed --timeout=120000
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
      use: { headless: false },
    },

    // Full browser tests (require auth)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: /api-probe/,
    },

    // Mobile tests (require auth)
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 12'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: /api-probe/,
    },

    // API probe & security tests — no auth needed, run standalone
    {
      name: 'api',
      testMatch: /(api-probe|security-api)\.spec\.js/,
      use: { headless: true },
    },
  ],
})
