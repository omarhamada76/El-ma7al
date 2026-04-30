import { defineConfig, devices } from '@playwright/test';

// The tests click around the dashboard which natively triggers fetch calls.
// Doing this on Live production WILL pollute the Live DB with Test Clients and invoices.
const isSafeToRun = process.env.STAGING_MODE === 'true';

if (!isSafeToRun) {
  console.error('\n🚨 CRITICAL WARNING: To protect your Live Supabase production data from being flooded with Playwright test invoices/clients, E2E tests are currently locked!\n👉 To run these End-to-End tests safely, you must explicitly run: `STAGING_MODE=true npx playwright test` AND ensure your .env file points to a harmless mock or staging database!\n');
  process.exit(0); // Exit successfully so we don't trigger CI failure alarms for just wanting to be safe.
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    // Automatically intercept preview server
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
