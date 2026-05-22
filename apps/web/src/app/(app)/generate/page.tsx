"use client";

/**
 * Generate page — best-of-N workflow runner.
 *
 * Lets the user:
 *   - Enter a prompt
 *   - Choose N (candidates to generate), K (top-K to select)
 *   - Choose provider (mock | fal) and optionally a model and seed
 *
 * Submits through the normal workflow/run path:
 *   POST /api/workflows  →  PATCH /api/workflows/:id  →  POST /api/workflows/:id/runs
 *
 * Results stream via SSE and are displayed in RunDebuggerPanel.
 */

import { useState, useCallback, lazy, Suspense } from "react";
import { useBestOfNRunner } from "@/hooks/useBestOfNRunner";
import { useSseSnapshot } from "@/hooks/useSseSnapshot";
import { useRunOutputs } from "@/hooks/useRunOutputs";
import { ResultsGrid } from "@/components/generate/ResultsGrid";

const RunDebuggerPanel = lazy(() =>
  import("@/components/debugger/RunDebuggerPanel").then((m) => ({
    default: m.RunDebuggerPanel,
  })),
);

const MAX_CHARS = 1000;

const TERMINAL_STATUSES = new Set(["completed", "failed", "partial_failure", "cancelled", "budget_exceeded"]);

function formatError(error: string): string {
  if (error.includes("not configured") || error.includes("API key")) {
    return `${error} → Add your key in Settings → Providers or set FAL_API_KEY in apps/web/.env.local.`;
  }
  return error;
}

type Provider = "mock" | "fal";

const MODEL_OPTIONS: Record<Provider, Array<{ value: string; label: string }>> = {
  mock: [{ value: "mock-sdxl", label: "Mock SDXL (deterministic)" }],
  fal: [
    { value: "fal-ai/flux/schnell",   label: "FLUX Schnell (fast)" },
    { value: "fal-ai/flux-pro/v1.1",  label: "FLUX Pro v1.1 (quality)" },
  ],
};

export default function GeneratePage() {
  const [prompt, setPrompt]     = useState("");
  const [n, setN]               = useState(4);
  const [k, setK]               = useState(2);
  const [provider, setProvider] = useState<Provider>("mock");
  const [model, setModel]       = useState("mock-sdxl");
  const [seed, setSeed]         = useState("");

  const runner  = useBestOfNRunner();
  const { snapshot, connected, error: sseError } = useSseSnapshot(
    runner.workflowId,
    runner.runId,
  );

  const isTerminal = snapshot ? TERMINAL_STATUSES.has(snapshot.status) : false;
  const { items: resultItems, allItems } = useRunOutputs(
    runner.workflowId,
    runner.runId,
    isTerminal,
  );

  // Collect error from the first failed node so the user sees why the run failed.
  const runFailureError = isTerminal && snapshot?.status !== "completed"
    ? (snapshot?.nodes.find((n) => n.status === "failed" && n.error)?.error ?? null)
    : null;
  const [allCandidatesOpen, setAllCandidatesOpen] = useState(false);

  const canRun =
    prompt.trim().length > 0 &&
    runner.status !== "creating" &&
    runner.status !== "starting" &&
    runner.status !== "running";

  // When provider changes, reset model to first option for that provider
  const handleProviderChange = useCallback((p: Provider) => {
    setProvider(p);
    setModel(MODEL_OPTIONS[p][0].value);
  }, []);

  const handleRun = useCallback(() => {
    if (!canRun) return;
    runner.run({
      prompt: prompt.trim(),
      n,
      k,
      provider,
      model,
      seed: seed.trim() ? parseInt(seed.trim(), 10) : undefined,
    });
  }, [canRun, runner, prompt, n, k, provider, model, seed]);

  const handleReset = useCallback(() => {
    runner.reset();
  }, [runner]);

  const isActive = runner.status === "creating" || runner.status === "starting" || runner.status === "running";

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1000, marginLeft: "auto", marginRight: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontSize: 26, fontWeight: 800,
          color: "var(--color-text-primary)",
          letterSpacing: "-0.02em", marginBottom: 4,
        }}>
          Generate
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          Generate N image candidates, score them with CLIP, and select the top K — powered by the engine workflow.
        </p>
      </div>

      {/* Controls */}
      <div style={{
        padding: 24,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        marginBottom: 24,
      }}>
        {/* Prompt */}
        <div style={{ marginBottom: 20 }}>
          <label style={{
            display: "block", fontSize: 13, fontWeight: 600,
            color: "var(--color-text-secondary)", marginBottom: 8,
          }}>
            Prompt
          </label>
          <div style={{ position: "relative" }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, MAX_CHARS))}
              placeholder="Describe what you want to generate..."
              rows={3}
              disabled={isActive}
              aria-label="Prompt"
              style={{
                width: "100%",
                padding: "12px 14px",
                paddingBottom: 28,
                backgroundColor: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                color: "var(--color-text-primary)",
                fontSize: 14,
                lineHeight: 1.6,
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
                opacity: isActive ? 0.6 : 1,
              }}
            />
            <span style={{
              position: "absolute", bottom: 8, right: 12,
              fontSize: 11, color: "var(--color-text-muted)",
            }}>
              {prompt.length}/{MAX_CHARS}
            </span>
          </div>
        </div>

        {/* N, K, Provider row */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
          {/* N */}
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
              Candidates (N)
            </label>
            <input
              type="number"
              min={1} max={16} step={1}
              value={n}
              onChange={(e) => setN(Math.max(1, Math.min(16, parseInt(e.target.value, 10) || 1)))}
              disabled={isActive}
              style={inputStyle}
            />
          </div>

          {/* K */}
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
              Select Top K
            </label>
            <input
              type="number"
              min={1} max={n} step={1}
              value={k}
              onChange={(e) => setK(Math.max(1, Math.min(n, parseInt(e.target.value, 10) || 1)))}
              disabled={isActive}
              style={inputStyle}
            />
          </div>

          {/* Provider */}
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as Provider)}
              disabled={isActive}
              style={selectStyle}
            >
              <option value="mock">Mock (no API key)</option>
              <option value="fal">Fal.ai (requires FAL_API_KEY)</option>
            </select>
          </div>

          {/* Model */}
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isActive}
              style={selectStyle}
            >
              {MODEL_OPTIONS[provider].map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Seed (optional) */}
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
              Seed (optional)
            </label>
            <input
              type="number"
              min={0} step={1}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              disabled={isActive}
              style={{ ...inputStyle, width: 100 }}
            />
          </div>
        </div>

        {/* Provider hint when fal is selected */}
        {provider === "fal" && (
          <div style={{
            padding: "8px 12px", borderRadius: 6, marginBottom: 12,
            backgroundColor: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.2)",
            fontSize: 12, color: "var(--color-text-secondary)",
          }}>
            Fal.ai requires a <code>FAL_API_KEY</code> env variable or a key configured in{" "}
            <strong>Settings → Providers</strong>.
          </div>
        )}

        {/* Error */}
        {runner.error && (
          <div style={{
            padding: "10px 14px", borderRadius: 8, marginBottom: 16,
            backgroundColor: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 13, color: "var(--color-error)",
          }}>
            {formatError(runner.error)}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={handleRun}
            disabled={!canRun}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              backgroundColor: canRun ? "var(--color-accent)" : "var(--color-surface-hover)",
              color: canRun ? "#fff" : "var(--color-text-muted)",
              cursor: canRun ? "pointer" : "default",
            }}
          >
            {runner.status === "creating"  ? "Creating workflow..." :
             runner.status === "starting"  ? "Starting run..." :
             runner.status === "running"   ? "Running..." :
             "Generate"}
          </button>

          {(runner.status === "error" || snapshot) && (
            <button
              onClick={handleReset}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid var(--color-border)",
                backgroundColor: "transparent",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}

          {runner.runId && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              Run: <code style={{ fontSize: 11 }}>{runner.runId.slice(0, 8)}</code>
              {connected && (
                <span style={{ marginLeft: 8, color: "var(--color-success, #22c55e)" }}>● live</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* SSE error */}
      {sseError && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 16,
          backgroundColor: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)",
          fontSize: 13, color: "var(--color-error)",
        }}>
          Live updates: {sseError}
        </div>
      )}

      {/* Run execution error — from failed node */}
      {runFailureError && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 16,
          backgroundColor: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)",
          fontSize: 13, color: "var(--color-error)",
        }}>
          Run failed: {formatError(runFailureError)}
        </div>
      )}

      {/* Results grid — rendered images after run completes */}
      {resultItems && resultItems.length > 0 && (
        <ResultsGrid items={resultItems} title="Top Candidates" />
      )}

      {/* All Candidates — collapsible section */}
      {allItems && allItems.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <button
            type="button"
            onClick={() => setAllCandidatesOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              marginBottom: allCandidatesOpen ? 12 : 0,
            }}
          >
            {/* Chevron */}
            <svg
              width="12" height="12" viewBox="0 0 12 12"
              fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              style={{
                color: "var(--color-text-muted)",
                transform: allCandidatesOpen ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 0.15s ease",
              }}
            >
              <path d="M3 4.5l3 3 3-3" />
            </svg>
            <span style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.01em",
            }}>
              All Candidates
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-muted)" }}>
              {allItems.length} image{allItems.length !== 1 ? "s" : ""}
            </span>
          </button>

          {allCandidatesOpen && (
            <ResultsGrid items={allItems} title={null} />
          )}
        </div>
      )}

      {/* Debug panel */}
      {snapshot && (
        <Suspense fallback={
          <div style={{ padding: 20, color: "var(--color-text-muted)", fontSize: 14 }}>
            Loading debugger...
          </div>
        }>
          <RunDebuggerPanel snapshot={snapshot} defaultView="tiers" />
        </Suspense>
      )}
    </div>
  );
}

// ── Shared inline styles ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: 90,
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  outline: "none",
};
