import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "QA_ALLOWED_TARGET_HOSTS=localhost,127.0.0.1 QA_DATA_DIR=./var/e2e QA_DATABASE_PATH=./var/e2e/qa.db corepack pnpm --filter @qa/web dev",
      url: "http://127.0.0.1:3000/api/health",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "corepack pnpm --filter @qa/demo-target dev",
      url: "http://127.0.0.1:3100/login",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
