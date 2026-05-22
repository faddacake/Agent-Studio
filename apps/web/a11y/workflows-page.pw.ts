/**
 * Live-browser accessibility verification for the workflows page.
 *
 * Uses Playwright + @axe-core/playwright to audit with real Chromium rendering,
 * validating items that jsdom could not check:
 *   1. color-contrast  — needs actual computed CSS colors
 *   2. aria-valid-attr-value — needs live DOM to resolve aria-controls targets
 *
 * The fixture file (a11y/fixtures/workflows.html) contains the actual design
 * tokens from globals.css and representative HTML across all card states.
 *
 * Run:  pnpm --filter /web test:a11y:browser
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = `file://${path.resolve(__dirname, "fixtures/workflows.html")}`;

test.describe("Workflows page – live-browser a11y audit (axe-core + Chromium)", () => {
  test("no WCAG 2.1 AA violations with real computed styles", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();

    // Print full violation detail for CI/dev visibility
    if (results.violations.length > 0) {
      console.log("\n╔══ BROWSER AXE VIOLATIONS ══════════════════════════════╗");
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
      `\nBrowser audit summary — passes: ${results.passes.length}  violations: ${results.violations.length}  incomplete: ${results.incomplete.length}`,
    );

    expect(
      results.violations,
      `Found ${results.violations.length} accessibility violation(s). See output above.`,
    ).toEqual([]);
  });
});
