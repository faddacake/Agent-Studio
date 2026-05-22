/**
 * E2E – Replay banner lifecycle against the running app.
 *
 * Uses seeded workflow + run data (written by global-setup.ts).
 * Only the replay run dispatch POST is intercepted; all other requests
 * hit the real running app.
 *
 * Run: pnpm --filter /web test:e2e
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SEED_FILE } from "./constants";

interface SeedFixture {
  workflowId: string;
  runId: string;
}

const seed: SeedFixture = JSON.parse(readFileSync(SEED_FILE, "utf8"));

// Auth bypass: the middleware skips JWT verification when MASTER_KEY is absent.
// Any non-empty cookie value passes. The webServer is started without MASTER_KEY.
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "aistudio_session", value: "e2e-bypass", domain: "localhost", path: "/" },
  ]);
});

test.describe("Replay banner – E2E lifecycle", () => {
  test("banner is visible when editor loads with ?replay param", async ({ page }) => {
    await page.goto(`/workflows/${seed.workflowId}?replay=${seed.runId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("replay-banner")).toBeVisible();
    await expect(page.getByTestId("replay-banner")).toContainText("Editing from run");
  });

  test("banner disappears after successful run dispatch (mocked 202)", async ({ page }) => {
    await page.goto(`/workflows/${seed.workflowId}?replay=${seed.runId}`);
    await page.waitForLoadState("networkidle");

    const banner = page.getByTestId("replay-banner");
    await expect(banner).toBeVisible();

    // Intercept only the replay dispatch; return a valid 202 without
    // triggering the engine or requiring provider credentials.
    await page.route(`/api/workflows/${seed.workflowId}/runs`, (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ id: "e2e-new-replay-run" }),
      }),
    );

    // Banner must still be visible before the button is clicked.
    await expect(banner).toBeVisible();

    await page.getByRole("button", { name: "Run Workflow" }).click();

    // After the 202 resolves, replayRunId is cleared → banner must be gone.
    await expect(banner).toBeHidden();
  });

  test("banner remains visible when run dispatch fails (mocked 500)", async ({ page }) => {
    await page.goto(`/workflows/${seed.workflowId}?replay=${seed.runId}`);
    await page.waitForLoadState("networkidle");

    const banner = page.getByTestId("replay-banner");
    await expect(banner).toBeVisible();

    await page.route(`/api/workflows/${seed.workflowId}/runs`, (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" }),
    );

    await page.getByRole("button", { name: "Run Workflow" }).click();

    // replayRunId must be preserved on failure — user should be able to retry.
    await expect(banner).toBeVisible();
  });
});
