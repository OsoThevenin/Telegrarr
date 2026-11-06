import { defineConfig, devices } from "@playwright/test";

import { E2E_PASSWORD, E2E_USER } from "./e2e/credentials";

const PORT = process.env.E2E_PORT ?? "8791";
const PYTHON = process.env.E2E_PYTHON ?? "python";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IS_CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  // One backend with one database: tests run one at a time.
  workers: 1,
  reporter: IS_CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: `${PYTHON} tests/e2e_server.py`,
    cwd: "..",
    url: `${BASE_URL}/healthz`,
    env: {
      E2E_PORT: PORT,
      TELEARR_ADMIN_USER: E2E_USER,
      TELEARR_ADMIN_PASS: E2E_PASSWORD,
    },
    reuseExistingServer: !IS_CI,
    stdout: "pipe",
  },
});
