import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]],
  use: {
    baseURL: "http://localhost:5183",
    trace: "on-first-retry"
  },
  webServer: {
    command: "pnpm run e2e:serve",
    url: "http://localhost:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});