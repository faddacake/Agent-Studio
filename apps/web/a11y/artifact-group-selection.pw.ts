/**
 * Playwright – artifact group bulk selection controls (static fixture).
 *
 * Verifies keyboard accessibility of the per-node All / Clear actions on the
 * run-history grouped export grid.  Uses a self-contained HTML fixture that
 * mirrors the React component's state machine and DOM structure.
 *
 * What is tested:
 *   1. aria-label attributes disambiguate per-group buttons from the global ones.
 *   2. Group buttons are reachable and activatable via keyboard (focus + Enter).
 *   3. Disabled boundaries are enforced: fully-selected → All disabled;
 *      fully-cleared → Clear disabled.
 *   4. Global All / None continue to work correctly after group-level changes.
 *
 * Run: pnpm --filter /web test:a11y:browser
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = `file://${path.join(__dirname, "fixtures/artifact-group-selection.html")}`;

test.describe("Artifact group selection – keyboard & accessibility", () => {
  // ── aria-label disambiguation ─────────────────────────────────────────────

  test("group buttons carry aria-labels that distinguish them from global controls", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Per-group buttons exist with descriptive labels
    await expect(page.getByRole("button", { name: "Select all from Node A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear Node A selection"  })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select all from Node B" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear Node B selection"  })).toBeVisible();

    // Global controls carry their own distinct labels
    await expect(page.getByRole("button", { name: "Select all artifacts",   exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deselect all artifacts", exact: true })).toBeVisible();
  });

  // ── Disabled boundary: fully selected ─────────────────────────────────────

  test("group All button is disabled when all artifacts in the group are already selected", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Initial state: everything selected → group All buttons should be disabled
    const btnAllA = page.getByRole("button", { name: "Select all from Node A" });
    const btnAllB = page.getByRole("button", { name: "Select all from Node B" });

    await expect(btnAllA).toBeDisabled();
    await expect(btnAllB).toBeDisabled();

    // Clear buttons should be enabled at this point
    await expect(page.getByRole("button", { name: "Clear Node A selection" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Clear Node B selection" })).toBeEnabled();
  });

  // ── Disabled boundary: fully cleared ─────────────────────────────────────

  test("group Clear button is disabled when no artifacts in the group are selected", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Clear Node A via keyboard: focus the button and press Enter
    const btnClearA = page.getByRole("button", { name: "Clear Node A selection" });
    await btnClearA.focus();
    await expect(btnClearA).toBeFocused();
    await page.keyboard.press("Enter");

    // Now Node A Clear should be disabled (nothing left to clear)
    await expect(btnClearA).toBeDisabled();

    // And Node A All should be enabled (can re-select)
    await expect(page.getByRole("button", { name: "Select all from Node A" })).toBeEnabled();

    // Node B should be unaffected
    await expect(page.getByRole("button", { name: "Clear Node B selection"  })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Select all from Node B" })).toBeDisabled();
  });

  // ── Keyboard: Enter activates Clear ───────────────────────────────────────

  test("pressing Enter on group Clear deselects all artifacts in that group", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Node A should start fully selected
    for (const p of ["a/1.png", "a/2.png", "a/3.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).toBeChecked();
    }

    // Focus group A Clear and activate via keyboard
    await page.getByRole("button", { name: "Clear Node A selection" }).focus();
    await page.keyboard.press("Enter");

    // Node A checkboxes should now be unchecked
    for (const p of ["a/1.png", "a/2.png", "a/3.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).not.toBeChecked();
    }

    // Node B checkboxes should remain checked
    for (const p of ["b/1.png", "b/2.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).toBeChecked();
    }
  });

  // ── Keyboard: Enter activates All ─────────────────────────────────────────

  test("pressing Enter on group All selects all artifacts in that group", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Start with nothing selected so the group All button is enabled
    await page.getByRole("button", { name: "Deselect all artifacts" }).click();

    for (const p of ["a/1.png", "a/2.png", "a/3.png", "b/1.png", "b/2.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).not.toBeChecked();
    }

    // Focus Node A's All button and activate via keyboard
    const btnAllA = page.getByRole("button", { name: "Select all from Node A" });
    await btnAllA.focus();
    await expect(btnAllA).toBeFocused();
    await page.keyboard.press("Enter");

    // Node A should now be fully selected
    for (const p of ["a/1.png", "a/2.png", "a/3.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).toBeChecked();
    }

    // Node B should remain deselected
    for (const p of ["b/1.png", "b/2.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).not.toBeChecked();
    }
  });

  // ── Space also activates ──────────────────────────────────────────────────

  test("pressing Space on group Clear also deselects all artifacts in that group", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    await page.getByRole("button", { name: "Clear Node B selection" }).focus();
    await page.keyboard.press("Space");

    for (const p of ["b/1.png", "b/2.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).not.toBeChecked();
    }

    // Node A unaffected
    for (const p of ["a/1.png", "a/2.png", "a/3.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).toBeChecked();
    }
  });

  // ── Global controls work after group changes ──────────────────────────────

  test("global All re-selects everything after a group has been cleared", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Clear both groups via keyboard
    await page.getByRole("button", { name: "Clear Node A selection" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Clear Node B selection" }).focus();
    await page.keyboard.press("Enter");

    // Nothing selected
    for (const p of ["a/1.png", "a/2.png", "a/3.png", "b/1.png", "b/2.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).not.toBeChecked();
    }

    // Global All restores full selection
    await page.getByRole("button", { name: "Select all artifacts", exact: true }).click();

    for (const p of ["a/1.png", "a/2.png", "a/3.png", "b/1.png", "b/2.png"]) {
      await expect(page.locator(`[data-path="${p}"]`)).toBeChecked();
    }
  });

  // ── Tab reachability ──────────────────────────────────────────────────────

  test("group All and Clear buttons are programmatically focusable when enabled", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // Clear Node A to make its All button enabled
    await page.getByRole("button", { name: "Clear Node A selection" }).click();

    const btnAllA = page.getByRole("button", { name: "Select all from Node A" });
    await btnAllA.focus();
    await expect(btnAllA).toBeFocused();
  });

  // ── axe-core WCAG audit ───────────────────────────────────────────────────

  test("no WCAG 2.1 AA violations in the group selection fixture", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();

    if (results.violations.length > 0) {
      console.log("\n╔══ AXE VIOLATIONS — artifact-group-selection ═══════════╗");
      for (const v of results.violations) {
        console.log(`\n  [${(v.impact ?? "unknown").toUpperCase()}] ${v.id}`);
        console.log(`  ${v.description}`);
        console.log(`  ${v.helpUrl}`);
        for (const node of v.nodes) {
          console.log(`    ● ${node.html.slice(0, 140)}`);
          if (node.failureSummary) {
            for (const line of node.failureSummary.split("\n").slice(0, 3)) {
              if (line.trim()) console.log(`      ${line.trim()}`);
            }
          }
        }
      }
      console.log("\n╚════════════════════════════════════════════════════════╝");
    }

    if (results.incomplete.length > 0) {
      console.log("\n── Needs manual review ─────────────────────────────────");
      for (const v of results.incomplete) {
        console.log(`  [${v.id}] ${v.description}`);
      }
    }

    console.log(
      `\nAxe audit summary — passes: ${results.passes.length}  violations: ${results.violations.length}  incomplete: ${results.incomplete.length}`,
    );

    expect(
      results.violations,
      `Found ${results.violations.length} accessibility violation(s). See output above.`,
    ).toEqual([]);
  });
});
