/**
 * Playwright – replay banner lifecycle (static fixture).
 *
 * Exercises the banner's visibility transitions using a self-contained HTML
 * fixture that mirrors WorkflowCanvas.tsx's success / failure paths.
 *
 * Run: pnpm --filter /web test:a11y:browser
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = `file://${path.join(__dirname, "fixtures/replay-banner.html")}`;

test.describe("Replay banner – lifecycle", () => {
  test("banner is visible when canvas is loaded from a historical run", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const banner = page.getByTestId("replay-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Editing from run");
    await expect(banner).toContainText("make changes and run as new");
  });

  test("banner disappears after successful run dispatch", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const banner = page.getByTestId("replay-banner");
    await expect(banner).toBeVisible();

    await page.click("#run-ok");

    await expect(banner).toBeHidden();
  });

  test("banner remains visible when run dispatch fails", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const banner = page.getByTestId("replay-banner");
    await expect(banner).toBeVisible();

    await page.click("#run-err");

    // Banner must still be visible — user should be able to retry.
    await expect(banner).toBeVisible();
    // Confirm the failure was registered on the button.
    await expect(page.locator("#run-err")).toHaveAttribute("data-run-failed", "true");
  });

  test("dismiss button manually hides the banner", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const banner = page.getByTestId("replay-banner");
    await expect(banner).toBeVisible();

    await page.click("[aria-label='Dismiss replay banner']");

    await expect(banner).toBeHidden();
  });
});
