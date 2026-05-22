/**
 * Accessibility audit for the /workflows page.
 *
 * Uses axe-core injected into a jsdom document that mirrors the static
 * accessibility structure rendered by the page component. Covers:
 *   - Bulk-selection toolbar
 *   - Workflow card (normal state)
 *   - Workflow card with overflow menu open
 *   - Workflow card with delete confirmation
 *   - Keyboard shortcut legend popover
 *
 * Run:  pnpm --filter @aistudio/web test:a11y
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import axe from "axe-core";

const axeSource: string = axe.source;
type AxeResults = axe.AxeResults;

// ---------------------------------------------------------------------------
// Representative HTML snapshot
// Reflects the accessibility attributes added across sessions 87-99.
// Each state is rendered simultaneously so axe can audit all in one pass.
// ---------------------------------------------------------------------------
const WORKFLOWS_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head><title>Workflows – Agent Studio</title></head>
<body>
<main>

  <!-- ── Persistent live region for bulk-selection count ─────────────── -->
  <span
    aria-live="polite"
    aria-atomic="true"
    style="position:absolute;width:1px;height:1px;overflow:hidden;white-space:nowrap;clip:rect(0,0,0,0);"
  >2 workflows selected</span>

  <!-- ── Bulk-selection toolbar ──────────────────────────────────────── -->
  <div role="toolbar" aria-label="Bulk workflow actions">
    <span>2 selected</span>
    <button>Select all (5)</button>
    <span aria-hidden="true">|</span>
    <button aria-label="Pin selected workflows">Pin</button>
    <button aria-label="Unpin selected workflows">Unpin</button>
    <button aria-label="Export selected workflows">Export</button>
    <button aria-label="Delete selected workflows">Delete</button>
    <span aria-hidden="true">|</span>
    <button>Clear selection</button>
    <span aria-hidden="true">⌘A · Esc</span>
  </div>

  <!-- ── Workflow card list ───────────────────────────────────────────── -->
  <div>

    <!-- Card 1 – normal state, overflow menu open ── -->
    <a
      href="/workflows/abc-123"
      title="Alpha Workflow&#10;&#10;Keyboard shortcuts:&#10;X — Run  R — Rename  E — Export&#10;D — Duplicate  P — Pin  Del — Delete"
      aria-label="Alpha Workflow — shortcuts: X Run, R Rename, E Export, D Duplicate, P Pin, Del Delete"
    >
      <span>
        <input
          type="checkbox"
          checked
          aria-label="Alpha Workflow"
          style="width:15px;height:15px;cursor:pointer;"
        />
      </span>

      <div>
        <span>
          <span>Alpha Workflow</span>
          <span title="Pinned" aria-hidden="true">📌</span>
        </span>
      </div>

      <p title="A test workflow description">A test workflow description</p>

      <div>
        <p title="2025-01-01T00:00:00Z">Updated 2 days ago</p>
        <span>
          <a href="/workflows/abc-123/history">History</a>
          <button aria-keyshortcuts="X" title="Run workflow">▶ Run  (X)</button>
          <button aria-keyshortcuts="P">Pin  (P)</button>

          <!-- Overflow menu (open) -->
          <span style="position:relative;">
            <button
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded="true"
              aria-controls="menu-abc-123"
            >···</button>
            <div
              role="menu"
              id="menu-abc-123"
              aria-label="Workflow actions"
            >
              <button role="menuitem" aria-keyshortcuts="R">Rename  (R)</button>
              <button role="menuitem">Description</button>
              <button role="menuitem">Tags</button>
              <button role="menuitem" aria-keyshortcuts="D">Duplicate  (D)</button>
              <button role="menuitem" aria-keyshortcuts="E">Export  (E)</button>
              <button role="menuitem" aria-keyshortcuts="Delete">Delete  (Del)</button>
            </div>
          </span>
        </span>
      </div>
    </a>

    <!-- Card 2 – delete confirmation state ── -->
    <a
      href="/workflows/def-456"
      title="Beta Workflow&#10;&#10;Keyboard shortcuts:&#10;X — Run  R — Rename  E — Export&#10;D — Duplicate  P — Pin  Del — Delete"
      aria-label="Beta Workflow — shortcuts: X Run, R Rename, E Export, D Duplicate, P Pin, Del Delete"
    >
      <span>
        <input
          type="checkbox"
          aria-label="Beta Workflow"
          style="width:15px;height:15px;cursor:pointer;"
        />
      </span>

      <div>
        <span>
          <span>Beta Workflow</span>
        </span>
      </div>

      <div>
        <p title="2025-01-02T00:00:00Z">Updated 1 day ago</p>
        <span
          role="alertdialog"
          aria-label="Confirm deletion of Beta Workflow"
        >
          <span>Delete?</span>
          <button aria-label="Yes, delete Beta Workflow">Yes</button>
          <button aria-label="No, cancel deletion">No</button>
        </span>
      </div>
    </a>

    <!-- Card 3 – rename edit state ── -->
    <a
      href="/workflows/ghi-789"
      aria-label="Gamma Workflow — shortcuts: X Run, R Rename, E Export, D Duplicate, P Pin, Del Delete"
    >
      <span>
        <input
          type="checkbox"
          aria-label="Gamma Workflow"
          style="width:15px;height:15px;"
        />
      </span>

      <div>
        <span>
          <!-- Rename input (edit mode) -->
          <input
            type="text"
            value="Gamma Workflow"
            aria-label="Rename workflow Gamma Workflow"
            aria-describedby="rename-hint-ghi-789"
          />
          <button>Save</button>
          <button>Cancel</button>
          <span id="rename-hint-ghi-789">↵ to save · Esc to cancel</span>
        </span>
      </div>

      <!-- Description edit state -->
      <span>
        <textarea
          rows="3"
          aria-label="Edit description for Gamma Workflow"
          aria-describedby="desc-hint-ghi-789"
        >A description</textarea>
        <span>
          <button>Save</button>
          <button>Cancel</button>
          <span id="desc-hint-ghi-789">⌘↵ to save · Esc to cancel</span>
        </span>
      </span>

      <!-- Tag edit state -->
      <span>
        <input
          type="text"
          aria-label="Edit tags for Gamma Workflow"
          aria-describedby="tag-hint-ghi-789"
          placeholder="social, video, draft"
        />
        <button>Save</button>
        <button>Cancel</button>
        <span id="tag-hint-ghi-789">↵ to save · Esc to cancel</span>
      </span>

      <div>
        <p>Updated 3 days ago</p>
        <span>
          <a href="/workflows/ghi-789/history">History</a>
          <button aria-keyshortcuts="X">▶ Run  (X)</button>
          <button aria-keyshortcuts="P">Pin  (P)</button>
          <span style="position:relative;">
            <button
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded="false"
              aria-controls="menu-ghi-789"
            >···</button>
          </span>
        </span>
      </div>
    </a>
  </div>

  <!-- ── Toolbar: ? shortcut legend trigger ──────────────────────────── -->
  <button
    aria-label="Keyboard shortcuts"
    aria-haspopup="dialog"
    aria-expanded="true"
    aria-controls="shortcut-panel"
  >?</button>

  <!-- ── Shortcut legend popover (open) ─────────────────────────────── -->
  <div
    role="dialog"
    id="shortcut-panel"
    aria-label="Keyboard shortcuts reference"
    aria-modal="false"
    tabindex="-1"
  >
    <div>Keyboard Shortcuts</div>
    <div><kbd>X</kbd><span>Run focused workflow</span></div>
    <div><kbd>R</kbd><span>Rename focused workflow</span></div>
    <div><kbd>E</kbd><span>Export focused workflow</span></div>
    <div><kbd>D</kbd><span>Duplicate focused workflow</span></div>
    <div><kbd>P</kbd><span>Pin / Unpin focused workflow</span></div>
    <div><kbd>Del</kbd><span>Open delete confirmation</span></div>
    <div><kbd>⌘A / Ctrl A</kbd><span>Select all</span></div>
    <div><kbd>Esc</kbd><span>Clear selection</span></div>
  </div>

</main>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Type for axe injected into the jsdom window
// ---------------------------------------------------------------------------
interface AxeWindow extends Window {
  axe: {
    run(
      context: Document,
      options: { runOnly: string[] },
      callback: (err: Error | null, results: AxeResults) => void,
    ): void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function printResults(results: AxeResults): void {
  if (results.violations.length > 0) {
    console.log("\n╔══ AXE VIOLATIONS ══════════════════════════════════════╗");
    for (const v of results.violations) {
      console.log(`\n  [${(v.impact ?? "unknown").toUpperCase()}] ${v.id}`);
      console.log(`  ${v.description}`);
      console.log(`  ${v.helpUrl}`);
      for (const node of v.nodes) {
        console.log(`    ● ${node.html.slice(0, 120)}`);
        if (node.failureSummary) {
          console.log(`      ${node.failureSummary.split("\n")[0]}`);
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
    `\nSummary — passes: ${results.passes.length}  violations: ${results.violations.length}  incomplete: ${results.incomplete.length}`,
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
describe("Workflows page – accessibility audit (axe-core + jsdom)", () => {
  test("no WCAG 2.1 AA violations in static page structure", async () => {
    const dom = new JSDOM(WORKFLOWS_HTML, {
      url: "http://localhost:3000/workflows",
      runScripts: "dangerously",
    });

    // Inject axe-core into the jsdom window so it has access to the DOM APIs
    dom.window.eval(axeSource);

    const results = await new Promise<AxeResults>((resolve, reject) => {
      (dom.window as unknown as AxeWindow).axe.run(
        dom.window.document,
        { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
        (err, res) => (err ? reject(err) : resolve(res)),
      );
    });

    printResults(results);

    assert.equal(
      results.violations.length,
      0,
      `Found ${results.violations.length} accessibility violation(s). See output above for details.`,
    );
  });
});
