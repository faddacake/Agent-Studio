/**
 * Playwright E2E configuration.
 *
 * Starts Next.js on an isolated port with a temporary DATA_DIR so tests
 * never touch the developer's local database.
 *
 * Run: pnpm --filter /web test:e2e
 */

import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_DIR } from "./e2e/constants";

const TEST_PORT = 3001;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",

  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${TEST_PORT}`,
    // Capture a trace on the first retry of any failed test so CI artifacts
    // include navigable trace files without generating noise on every pass.
    trace: "on-first-retry",
  },

  // Allow one retry in CI so the trace capture condition is meaningful.
  retries: process.env.CI ? 1 : 0,

  webServer: {
    /** Next.js respects the PORT env var; DATA_DIR isolates the SQLite DB. */
    command: "pnpm dev",
    url: `http://localhost:${TEST_PORT}`,
    timeout: 90_000,
    /**
     * Reuse an already-running dev server on TEST_PORT locally so watch-mode
     * iterations are fast. In CI, always start fresh.
     */
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(TEST_PORT),
      DATA_DIR: E2E_DATA_DIR,
      // Intentionally absent: MASTER_KEY — activates the dev auth bypass so
      // any non-empty session cookie passes the middleware without JWT verification.
    },
  },
});
