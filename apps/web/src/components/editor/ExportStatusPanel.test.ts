/**
 * Tests for ExportStatusPanel render output.
 *
 * Covers:
 *   - idle             → renders "Preview" + "Export" buttons
 *   - triggering       → renders static "Export starting…" text, no pulsing dot
 *   - fetching (null status)   → pulsing dot + "Queued" stage badge + "Export" label
 *   - fetching (pending)       → pulsing dot + "Queued" stage badge
 *   - fetching (running)       → pulsing dot + "Rendering" stage badge
 *   - done (no renderResult)   → "Export queued", no dot, dismiss button
 *   - done (with renderResult) → "Export done", scene metadata, dismiss button
 *   - error                    → "Export failed", Retry button with error title
 *   - polling indicator absent on done/error/idle/triggering states
 *
 * Accessibility contract (live region):
 *   - role="status" aria-live="polite" region is present in every state
 *   - idle → empty announcement (no noise on reset)
 *   - triggering → "Export starting"
 *   - fetching/null → "Export exporting"
 *   - fetching/pending → "Export queued"
 *   - fetching/running → "Export rendering"
 *   - done (no result) → "Export queued successfully"
 *   - done (with result) → "Export done"
 *   - error → "Export failed"
 *   - pulsing dot is aria-hidden (not the live text)
 *
 * Uses react-dom/server renderToStaticMarkup — no browser globals required.
 *
 * Run: pnpm --filter /web test:components
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Component under test (server import — "use client" is a string expression here)
const { ExportStatusPanel } = await import("./ExportStatusPanel.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { ExportJobStatusResponse } from "@/lib/exportJobStatus";
import type { ExportJobHookState, ExportMode } from "@/hooks/useExportJob";

type Props = {
  state: ExportJobHookState;
  jobStatus?: ExportJobStatusResponse | null;
  error?: string | null;
  exportMode?: ExportMode | null;
};

function render({ state, jobStatus = null, error = null, exportMode = null }: Props): string {
  return renderToStaticMarkup(
    createElement(ExportStatusPanel, {
      state,
      jobStatus,
      error,
      exportMode,
      startedAt: null,
      onExport: () => {},
      onPreview: () => {},
      onReset: () => {},
    }),
  );
}

function makeJobStatus(
  status: ExportJobStatusResponse["status"],
  withArtifact = false,
): ExportJobStatusResponse {
  return {
    id: "job-1",
    projectId: "proj-1",
    status,
    totalDurationMs: 5000,
    sceneCount: 2,
    renderResult:
      status === "completed"
        ? {
            sceneCount: 2,
            totalDurationMs: 5000,
            artifacts: withArtifact
              ? [{ path: "/data/export.mp4", mimeType: "video/mp4" }]
              : [],
          }
        : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Extract the text content of the aria-live region from rendered HTML. */
function liveRegionText(html: string): string {
  // Match content inside role="status" span.
  // renderToStaticMarkup omits data-reactroot so attribute order may vary.
  const m = html.match(/role="status"[^>]*>([^<]*)</);
  return m ? m[1]! : "";
}

// ── idle ──────────────────────────────────────────────────────────────────────

describe("ExportStatusPanel — idle", () => {
  it("renders an Export button", () => {
    const html = render({ state: "idle" });
    assert.ok(html.includes("Export"), "should contain 'Export'");
    assert.ok(html.includes("<button"), "should be a button element");
  });

  it("renders a Preview button alongside Export", () => {
    const html = render({ state: "idle" });
    assert.ok(html.includes("Preview"), "should contain 'Preview' button");
  });

  it("does not show a pulsing dot", () => {
    const html = render({ state: "idle" });
    assert.ok(!html.includes("esp-pulse"), "should not contain polling animation");
  });
});

// ── triggering ────────────────────────────────────────────────────────────────

describe("ExportStatusPanel — triggering", () => {
  it("renders static 'starting…' text", () => {
    const html = render({ state: "triggering" });
    assert.ok(html.includes("starting"), "should contain 'starting'");
  });

  it("shows a pulsing dot while the POST is in flight", () => {
    const html = render({ state: "triggering" });
    assert.ok(html.includes("esp-pulse"), "pulsing dot should appear during triggering state");
  });

  it("does not show a Retry or dismiss button", () => {
    const html = render({ state: "triggering" });
    assert.ok(!html.includes("Retry"), "no Retry in triggering state");
    assert.ok(!html.includes("Dismiss") && !html.includes("✕"), "no dismiss in triggering state");
  });
});

// ── fetching ──────────────────────────────────────────────────────────────────

describe("ExportStatusPanel — fetching (polling indicator)", () => {
  it("renders a pulsing dot when fetching with null jobStatus", () => {
    const html = render({ state: "fetching", jobStatus: null });
    assert.ok(html.includes("esp-pulse"), "pulsing dot animation must be present");
  });

  it("renders 'Queued' stage badge when jobStatus is null", () => {
    const html = render({ state: "fetching", jobStatus: null });
    assert.ok(html.includes("Queued"), "fallback stage badge should be 'Queued'");
  });

  it("renders pulsing dot when job is pending", () => {
    const html = render({ state: "fetching", jobStatus: makeJobStatus("pending") });
    assert.ok(html.includes("esp-pulse"), "pulsing dot must appear for pending job");
  });

  it("renders 'Queued' label when job is pending", () => {
    const html = render({ state: "fetching", jobStatus: makeJobStatus("pending") });
    assert.ok(html.includes("Queued"), "label should be 'Queued' for pending job");
  });

  it("renders pulsing dot when job is running", () => {
    const html = render({ state: "fetching", jobStatus: makeJobStatus("running") });
    assert.ok(html.includes("esp-pulse"), "pulsing dot must appear for running job");
  });

  it("renders 'Rendering' stage badge when job is running", () => {
    const html = render({ state: "fetching", jobStatus: makeJobStatus("running") });
    assert.ok(html.includes("Rendering"), "stage badge should be 'Rendering' for running job");
  });

  it("does not show dismiss or Retry buttons while fetching", () => {
    const html = render({ state: "fetching", jobStatus: null });
    assert.ok(!html.includes("Retry"), "no Retry while fetching");
    assert.ok(!html.includes("✕"), "no dismiss while fetching");
  });
});

// ── done ──────────────────────────────────────────────────────────────────────

describe("ExportStatusPanel — done (no renderResult)", () => {
  it("shows '✓ Export queued' when renderResult is absent", () => {
    const status = makeJobStatus("completed", false);
    status.renderResult = null;
    const html = render({ state: "done", jobStatus: status });
    assert.ok(html.includes("Export queued"), "should show 'Export queued' without renderResult");
  });

  it("does not show the pulsing dot", () => {
    const html = render({ state: "done", jobStatus: null });
    assert.ok(!html.includes("esp-pulse"), "no polling dot in done state");
  });

  it("shows the dismiss button", () => {
    const html = render({ state: "done", jobStatus: null });
    assert.ok(html.includes("✕"), "dismiss button must be present");
  });
});

describe("ExportStatusPanel — done (with renderResult)", () => {
  const completedStatus = makeJobStatus("completed");

  it("shows '✓ Export done' when renderResult is present", () => {
    const html = render({ state: "done", jobStatus: completedStatus });
    assert.ok(html.includes("Export done"), "should show 'Export done' with renderResult");
  });

  it("shows scene metadata", () => {
    const html = render({ state: "done", jobStatus: completedStatus });
    assert.ok(html.includes("scenes"), "should include scenes count");
  });

  it("does not show the pulsing dot", () => {
    const html = render({ state: "done", jobStatus: completedStatus });
    assert.ok(!html.includes("esp-pulse"), "no polling dot in done state");
  });

  it("shows the dismiss button", () => {
    const html = render({ state: "done", jobStatus: completedStatus });
    assert.ok(html.includes("✕"), "dismiss button must be present");
  });

  it("dismiss button carries Dismiss (Esc) title hint", () => {
    const html = render({ state: "done", jobStatus: completedStatus });
    assert.ok(html.includes("Dismiss (Esc)"), "dismiss button must expose Esc shortcut hint");
  });
});

// ── error ─────────────────────────────────────────────────────────────────────

describe("ExportStatusPanel — error", () => {
  it("renders 'Export failed' text", () => {
    const html = render({ state: "error", error: "timeout" });
    assert.ok(html.includes("Export failed"), "'Export failed' text must appear");
  });

  it("renders Retry button", () => {
    const html = render({ state: "error", error: "timeout" });
    assert.ok(html.includes("Retry"), "Retry button must appear");
  });

  it("renders the humanized error message inline (not raw string in button title)", () => {
    // humanizeExportError("network timeout") → "Render timed out"
    // The humanized message appears inline; the button title carries the shortcut hint.
    const html = render({ state: "error", error: "network timeout" });
    assert.ok(html.includes("timed out"), "humanized error text must appear in rendered output");
  });

  it("Retry button title includes the shortcut hint", () => {
    const html = render({ state: "error", error: "timeout" });
    // The hint is platform-dependent; accept either form.
    assert.ok(
      html.includes("Retry (⌘E)") || html.includes("Retry (Ctrl+E)"),
      "Retry button must expose the export keyboard shortcut hint",
    );
  });

  it("Retry button title includes hint even when error is null", () => {
    const html = render({ state: "error", error: null });
    assert.ok(
      html.includes("Retry (⌘E)") || html.includes("Retry (Ctrl+E)"),
      "shortcut hint must appear even without an error message",
    );
  });

  it("does not show the pulsing dot", () => {
    const html = render({ state: "error", error: "bad" });
    assert.ok(!html.includes("esp-pulse"), "no polling dot in error state");
  });
});

// ── Accessibility: live region contract ───────────────────────────────────────

describe("ExportStatusPanel — aria-live region present in every state", () => {
  const states: ExportJobHookState[] = ["idle", "triggering", "fetching", "done", "error"];

  for (const state of states) {
    it(`role="status" region exists in state: ${state}`, () => {
      const html = render({ state });
      assert.ok(html.includes('role="status"'), `live region must be present in "${state}" state`);
      assert.ok(html.includes('aria-live="polite"'), `aria-live="polite" must be present in "${state}" state`);
    });
  }
});

describe("ExportStatusPanel — live region announcement text", () => {
  it("idle → empty string (no noise on reset)", () => {
    const text = liveRegionText(render({ state: "idle" }));
    assert.equal(text, "", "idle must emit empty announcement");
  });

  it("triggering → 'Export starting'", () => {
    const text = liveRegionText(render({ state: "triggering" }));
    assert.equal(text, "Export starting");
  });

  it("fetching with null jobStatus → 'Export exporting'", () => {
    const text = liveRegionText(render({ state: "fetching", jobStatus: null }));
    assert.equal(text, "Export exporting");
  });

  it("fetching with pending job → 'Export queued'", () => {
    const text = liveRegionText(
      render({ state: "fetching", jobStatus: makeJobStatus("pending") }),
    );
    assert.equal(text, "Export queued");
  });

  it("fetching with running job → 'Export rendering'", () => {
    const text = liveRegionText(
      render({ state: "fetching", jobStatus: makeJobStatus("running") }),
    );
    assert.equal(text, "Export rendering");
  });

  it("done with renderResult → 'Export done'", () => {
    const text = liveRegionText(
      render({ state: "done", jobStatus: makeJobStatus("completed") }),
    );
    assert.equal(text, "Export done");
  });

  it("done without renderResult → 'Export queued successfully'", () => {
    const status = makeJobStatus("completed");
    status.renderResult = null;
    const text = liveRegionText(render({ state: "done", jobStatus: status }));
    assert.equal(text, "Export queued successfully");
  });

  it("done with null jobStatus → 'Export queued successfully'", () => {
    const text = liveRegionText(render({ state: "done", jobStatus: null }));
    assert.equal(text, "Export queued successfully");
  });

  it("error → 'Export failed'", () => {
    const text = liveRegionText(render({ state: "error", error: "timeout" }));
    assert.equal(text, "Export failed");
  });

  it("triggering with preview mode → 'Preview starting'", () => {
    const text = liveRegionText(render({ state: "triggering", exportMode: "preview" }));
    assert.equal(text, "Preview starting");
  });
});

describe("ExportStatusPanel — decorative pulse dot is aria-hidden", () => {
  it("the pulsing dot span carries aria-hidden='true'", () => {
    const html = render({ state: "fetching", jobStatus: makeJobStatus("pending") });
    // The dot span's inline style contains "animation:" referencing esp-pulse.
    // Find that span tag and confirm aria-hidden="true" is on the same element.
    // (Note: html.indexOf("esp-pulse") would hit the @keyframes block first,
    //  so we locate by the "animation:" inline style property instead.)
    const animIdx = html.indexOf("animation:");
    assert.ok(animIdx !== -1, "dot span with animation style must be present");
    // Walk back to the opening <span tag
    const spanStart = html.lastIndexOf("<span", animIdx);
    // Walk forward to the closing >
    const spanEnd = html.indexOf(">", animIdx);
    const spanTag = html.slice(spanStart, spanEnd + 1);
    assert.ok(
      spanTag.includes('aria-hidden="true"'),
      "pulsing dot must be aria-hidden so it is not read as live content",
    );
  });

  it("the live region text does not contain animation CSS references", () => {
    const html = render({ state: "fetching", jobStatus: makeJobStatus("running") });
    const text = liveRegionText(html);
    assert.ok(!text.includes("esp-pulse"), "animation name must not appear in live text");
    assert.ok(!text.includes("keyframe"), "CSS must not appear in live text");
  });
});
