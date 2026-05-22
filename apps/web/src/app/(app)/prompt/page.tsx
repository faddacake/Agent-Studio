"use client";

import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import Link from "next/link";
import { type ModelCategory, getModelsByCategory, getDefaultModels, estimateCost, getModelById, getModelsWithinBudget } from "@/config/models";
import { PRESETS, getPresetById, type PromptPreset } from "@/config/presets";
import { BUDGET_WEIGHTS } from "@/lib/ranking/score";
import { usePromptRunner } from "@/hooks/usePromptRunner";
import { useLicenseTier } from "@/hooks/useLicenseTier";
import { useSocialVariants } from "@/hooks/useSocialVariants";
import { useExportBundle } from "@/hooks/useExportBundle";
import { saveCanvasData } from "@/hooks/useCanvasStore";
import { ModelSelector } from "@/components/prompt/ModelSelector";
import { AdvancedControls } from "@/components/prompt/AdvancedControls";
import type { ResultsTab } from "@/components/prompt/ResultsGrid";
import type { PlatformTarget } from "@/components/prompt/SocialVariantsPanel";

const ResultsGrid = lazy(() =>
  import("@/components/prompt/ResultsGrid").then((m) => ({ default: m.ResultsGrid })),
);
const CompareModal = lazy(() =>
  import("@/components/prompt/CompareModal").then((m) => ({ default: m.CompareModal })),
);
const SocialVariantsPanel = lazy(() =>
  import("@/components/prompt/SocialVariantsPanel").then((m) => ({ default: m.SocialVariantsPanel })),
);
const ExportButton = lazy(() =>
  import("@/components/prompt/ExportButton").then((m) => ({ default: m.ExportButton })),
);

const MAX_CHARS = 2000;

export default function PromptStudioPage() {
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<ModelCategory>("image");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(getDefaultModels("image")));
  const [activePreset, setActivePreset] = useState<PromptPreset | null>(null);
  const [maxBudget, setMaxBudget] = useState<string>("");
  const [showCompare, setShowCompare] = useState(false);
  const [resultsTab, setResultsTab] = useState<ResultsTab>("results");
  const [platformTarget, setPlatformTarget] = useState<PlatformTarget>("auto");

  const runner = usePromptRunner();
  const social = useSocialVariants();
  const exporter = useExportBundle();
  const { limits } = useLicenseTier();
  const models = useMemo(() => getModelsByCategory(category), [category]);
  const parsedBudget = maxBudget ? parseFloat(maxBudget) : null;
  const hasBudget = parsedBudget !== null && parsedBudget > 0 && !isNaN(parsedBudget);
  const affordableModels = useMemo(
    () => (hasBudget ? getModelsWithinBudget(models, parsedBudget!) : null),
    [models, hasBudget, parsedBudget],
  );
  const selectedModels = useMemo(
    () => Array.from(selected).map(getModelById).filter(Boolean),
    [selected],
  );
  const cost = useMemo(() => estimateCost(selectedModels.filter((m) => m!.supported) as any), [selectedModels]);
  const supportedSelected = selectedModels.filter((m) => m?.supported).length;
  const exceedsModelLimit = supportedSelected > limits.maxModels;
  const canRun = prompt.trim().length > 0 && selectedModels.some((m) => m?.supported) && !exceedsModelLimit && runner.overallStatus !== "creating" && runner.overallStatus !== "running";
  const rankingWeights = limits.budgetOptimizer && hasBudget ? BUDGET_WEIGHTS : undefined;

  const handleCategoryChange = useCallback((cat: ModelCategory) => {
    setCategory(cat);
    setActivePreset(null);
    const catModels = getModelsByCategory(cat);
    if (hasBudget) {
      const affordable = getModelsWithinBudget(catModels, parsedBudget!);
      setSelected(new Set(affordable.filter((m) => m.supported).map((m) => m.id)));
    } else {
      setSelected(new Set(getDefaultModels(cat)));
    }
  }, [hasBudget, parsedBudget]);

  const handleBudgetChange = useCallback((value: string) => {
    setMaxBudget(value);
    const budget = parseFloat(value);
    if (value && budget > 0 && !isNaN(budget)) {
      const affordable = getModelsWithinBudget(models, budget);
      setSelected(new Set(affordable.filter((m) => m.supported).map((m) => m.id)));
    }
  }, [models]);

  const handlePresetChange = useCallback((presetId: string) => {
    if (!presetId) {
      setActivePreset(null);
      return;
    }
    const preset = getPresetById(presetId);
    if (!preset) return;
    setActivePreset(preset);
    setCategory(preset.category);
    setSelected(new Set(preset.defaultModels));
  }, []);

  const handleClearPreset = useCallback(() => {
    setActivePreset(null);
    setSelected(new Set(getDefaultModels(category)));
  }, [category]);

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const supported = models.filter((m) => m.supported).map((m) => m.id);
    setSelected((prev) => {
      const allSelected = supported.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set([...prev, ...supported]);
    });
  }, [models]);

  const handleGenerateSocial = useCallback(() => {
    if (!prompt.trim()) return;
    const winner = runner.results.find((r) => r.modelId === runner.winnerId && r.outputUrl);
    const firstCompleted = runner.results.find((r) => r.status === "completed" && r.outputUrl);
    const target = winner || firstCompleted;
    const topic = prompt.split(/\s+/).slice(0, 5).join(" ") || "AI generated content";
    social.generate(prompt, target?.outputUrl ?? "", topic);
  }, [runner.results, runner.winnerId, prompt, social]);

  const handleTabChange = useCallback((tab: ResultsTab) => {
    setResultsTab(tab);
    if (tab === "social" && social.status === "idle") {
      handleGenerateSocial();
    }
  }, [social.status, handleGenerateSocial]);

  // When a run finishes while the Social tab is already showing, upgrade from
  // image-free variants (generated before the run completed) to image-backed
  // ones now that outputUrl is available. Only fires on status transition.
  useEffect(() => {
    if (runner.overallStatus !== "completed" || resultsTab !== "social") return;
    if (social.status !== "loaded") return;
    const hasNoImages = !social.images || Object.values(social.images).every((u) => !u);
    if (!hasNoImages) return;
    const winner = runner.results.find((r) => r.modelId === runner.winnerId && r.outputUrl);
    const firstCompleted = runner.results.find((r) => r.status === "completed" && r.outputUrl);
    const target = winner || firstCompleted;
    if (!target?.outputUrl) return;
    const topic = prompt.split(/\s+/).slice(0, 5).join(" ") || "AI generated content";
    social.generate(prompt, target.outputUrl, topic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.overallStatus]);

  const handleExport = useCallback(() => {
    // Resolve the best available image URL from three sources:
    // 1. Runner result with outputUrl (winner preferred, then first completed)
    const winner = runner.results.find((r) => r.modelId === runner.winnerId && r.outputUrl);
    const firstCompleted = runner.results.find((r) => r.status === "completed" && r.outputUrl);
    const target = winner || firstCompleted;

    // 2. Social variant images (generated separately)
    const socialImageUrl = social.images
      ? Object.values(social.images).find((url) => !!url) ?? null
      : null;

    // Use the best available, or a prompt-derived placeholder so the export API
    // can still generate text content (captions, hashtags, CSV).
    const imageUrl = target?.outputUrl ?? socialImageUrl ?? "placeholder:no-image";

    const topic = prompt.split(/\s+/).slice(0, 5).join(" ") || "AI generated content";

    // Resolve model name from the winning/completed result, or first supported model
    const modelName = target?.modelName
      ?? runner.results.find((r) => r.status === "completed")?.modelName
      ?? "AI Model";

    // Map PlatformTarget → export filter key (matching PLATFORM_FILE_NAMES in exportService)
    const PLATFORM_EXPORT_KEYS: Record<string, string> = {
      instagram: "instagram",
      tiktok: "tiktok",
      x: "x",
      linkedin: "linkedin",
      youtubeShorts: "youtube",
    };
    const platformFilter = platformTarget === "auto" ? undefined : PLATFORM_EXPORT_KEYS[platformTarget];

    exporter.exportCampaign({
      prompt,
      imageUrl,
      topic,
      modelName,
      platformFilter,
    });
  }, [runner.results, runner.winnerId, prompt, exporter, platformTarget, social.images]);

  const hasCompletedResults = runner.results.some((r) => r.status === "completed");

  const seedCanvasData = useCallback(() => {
    if (process.env.NODE_ENV !== "production") console.log("[CanvasSeed] start");

    const winner = runner.results.find((r) => r.modelId === runner.winnerId && r.outputUrl);
    const firstCompleted = runner.results.find((r) => r.status === "completed" && r.outputUrl);
    const target = winner || firstCompleted;
    const completedAny = runner.results.find((r) => r.status === "completed");

    const socialImageUrl = social.images
      ? Object.values(social.images).find((url) => !!url) ?? ""
      : "";
    const imageUrl = target?.outputUrl ?? socialImageUrl;
    const modelName = target?.modelName ?? completedAny?.modelName ?? "AI Model";
    const topic = prompt.split(/\s+/).slice(0, 5).join(" ") || "AI generated content";

    if (process.env.NODE_ENV !== "production") console.log("[CanvasSeed] seeding", { promptLen: prompt.length });

    if (social.variants) {
      saveCanvasData({ prompt, topic, imageUrl, modelName, variants: social.variants });
    } else {
      // Seed with minimal variants synchronously so canvas has data immediately.
      // Also fire-and-forget a fetch to upgrade with API-generated variants.
      saveCanvasData({ prompt, topic, imageUrl, modelName, variants: buildMinimalVariants(prompt) });
      fetch("/api/social-format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: prompt, imageUrl, topic }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.variants) {
            saveCanvasData({ prompt, topic, imageUrl, modelName, variants: data.variants });
          }
        })
        .catch(() => { /* minimal variants already saved */ });
    }
    if (process.env.NODE_ENV !== "production") console.log("[CanvasSeed] saved");
  }, [runner.results, runner.winnerId, prompt, social.variants, social.images]);

  const handleRun = useCallback(() => {
    social.reset();
    setResultsTab("results");
    setShowCompare(false);
    const toRun = selectedModels.filter(Boolean) as any[];
    if (toRun.length > 0) runner.run(prompt, toRun);
  }, [prompt, selectedModels, runner, social]);

  const handleRunAll = useCallback(() => {
    social.reset();
    setResultsTab("results");
    setShowCompare(false);
    const all = models.filter((m) => m.supported);
    if (all.length > 0) {
      setSelected(new Set(all.map((m) => m.id)));
      runner.run(prompt, all);
    }
  }, [prompt, models, runner, social]);

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, marginLeft: "auto", marginRight: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          AI Prompt Studio
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          Run one prompt across top AI models and compare results
        </p>
      </div>

      {/* Input panel */}
      <div style={{
        padding: 24,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        marginBottom: 24,
      }}>
        {/* Preset selector (Pro only) */}
        {limits.presets ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              Optimize For
            </label>
            <select
              value={activePreset?.id ?? ""}
              onChange={(e) => handlePresetChange(e.target.value)}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                outline: "none",
                minWidth: 180,
              }}
            >
              <option value="">None (Manual)</option>
              <optgroup label="Image">
                {PRESETS.filter((p) => p.category === "image").map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Video">
                {PRESETS.filter((p) => p.category === "video").map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Voice">
                {PRESETS.filter((p) => p.category === "voice").map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            </select>
            {activePreset && (
              <>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 6,
                  backgroundColor: "rgba(59,130,246,0.12)",
                  color: "var(--color-accent)",
                }}>
                  Preset Active
                </span>
                <button
                  onClick={handleClearPreset}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--color-border)",
                    backgroundColor: "transparent",
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  Clear Preset
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 12, color: "var(--color-text-muted)" }}>
            Presets
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, backgroundColor: "rgba(139,92,246,0.12)", color: "rgb(139,92,246)" }}>
              Pro
            </span>
          </div>
        )}

        {/* Target Platform */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
            Target Platform
          </label>
          <select
            value={platformTarget}
            onChange={(e) => setPlatformTarget(e.target.value as PlatformTarget)}
            style={{
              padding: "7px 10px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              outline: "none",
              minWidth: 160,
            }}
          >
            <option value="auto">Auto (All Platforms)</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="x">X</option>
            <option value="linkedin">LinkedIn</option>
            <option value="youtubeShorts">YouTube Shorts</option>
          </select>
          {platformTarget !== "auto" && (
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 6,
              backgroundColor: "rgba(59,130,246,0.12)",
              color: "var(--color-accent)",
            }}>
              {platformTarget === "x" ? "X" : platformTarget === "youtubeShorts" ? "YouTube Shorts" : platformTarget.charAt(0).toUpperCase() + platformTarget.slice(1)} Only
            </span>
          )}
        </div>

        {/* Prompt textarea */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_CHARS))}
            placeholder="Describe what you want to generate..."
            rows={4}
            aria-label="Prompt input"
            style={{
              width: "100%",
              padding: "14px 16px",
              paddingBottom: 28,
              backgroundColor: "var(--color-bg-primary)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              color: "var(--color-text-primary)",
              fontSize: 15,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{
            position: "absolute",
            bottom: 8,
            right: 12,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              {prompt.length}/{MAX_CHARS}
            </span>
            <button disabled style={{
              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
              border: "1px solid var(--color-border)", backgroundColor: "transparent",
              color: "var(--color-text-muted)", cursor: "default",
            }}>
              Enhance (Soon)
            </button>
          </div>
        </div>

        {/* Category selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 8 }}>
            Generation Type
          </label>
          <div style={{ display: "flex", gap: 4, backgroundColor: "var(--color-bg-primary)", borderRadius: 8, padding: 3, width: "fit-content" }}>
            {(["image", "video", "voice"] as ModelCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: category === cat ? "var(--color-surface)" : "transparent",
                  color: category === cat ? "var(--color-text-primary)" : "var(--color-text-muted)",
                  transition: "all 100ms ease",
                  textTransform: "capitalize",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Model selector */}
        <ModelSelector
          category={category}
          models={models}
          selected={selected}
          onToggle={handleToggle}
          onSelectAll={handleSelectAll}
        />

        {/* Advanced controls */}
        <AdvancedControls key={activePreset?.id ?? "manual"} category={category} presetParams={activePreset?.defaultParams} />

        {/* Budget input (Pro only) */}
        {limits.budgetOptimizer ? (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              Max Budget (optional)
            </label>
            <div style={{ position: "relative", width: 120 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--color-text-muted)" }}>$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxBudget}
                onChange={(e) => handleBudgetChange(e.target.value)}
                placeholder="e.g. 0.25"
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 22px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-bg-primary)",
                  color: "var(--color-text-primary)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            {hasBudget && (
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 6,
                backgroundColor: "rgba(34,197,94,0.12)",
                color: "var(--color-success)",
              }}>
                Budget Optimized
              </span>
            )}
            {hasBudget && affordableModels && affordableModels.filter((m) => m.supported).length === 0 && (
              <span style={{ fontSize: 12, color: "var(--color-error)" }}>
                No models available within this budget.
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12, color: "var(--color-text-muted)" }}>
            Budget Optimizer
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, backgroundColor: "rgba(139,92,246,0.12)", color: "rgb(139,92,246)" }}>
              Pro
            </span>
          </div>
        )}

        {/* Cost estimate + run buttons */}
        <div style={{
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Estimated cost: <strong style={{ color: "var(--color-text-secondary)" }}>{cost}</strong>
              {" · "}{supportedSelected} model{supportedSelected !== 1 ? "s" : ""} selected
              {limits.maxModels < Infinity && (
                <span style={{ color: "var(--color-text-muted)" }}> (max {limits.maxModels})</span>
              )}
            </span>
            {exceedsModelLimit && (
              <span style={{ fontSize: 12, color: "var(--color-error)" }}>
                Upgrade to {limits.maxModels === 1 ? "Creator" : "Pro"} to unlock {limits.maxModels === 1 ? "up to 3" : "unlimited"} model comparisons.
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleRunAll}
              disabled={!prompt.trim() || runner.overallStatus === "creating" || runner.overallStatus === "running"}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid var(--color-border)",
                backgroundColor: "transparent",
                color: prompt.trim() ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                cursor: prompt.trim() ? "pointer" : "default",
              }}
            >
              Run All in {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
            <button
              onClick={handleRun}
              disabled={!canRun}
              style={{
                padding: "10px 22px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                border: "none",
                backgroundColor: canRun ? "var(--color-accent)" : "var(--color-surface-hover)",
                color: canRun ? "#fff" : "var(--color-text-muted)",
                cursor: canRun ? "pointer" : "default",
              }}
            >
              {runner.overallStatus === "creating"
                ? "Creating..."
                : runner.overallStatus === "running"
                  ? "Running..."
                  : "Run Across Selected Models"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {runner.results.length > 0 && (
        <Suspense fallback={<div style={{ padding: 20, color: "var(--color-text-muted)" }}>Loading results...</div>}>
          <ResultsGrid
            results={runner.results}
            models={selectedModels.filter(Boolean) as any[]}
            workflowId={runner.workflowId}
            winnerId={runner.winnerId}
            rankingWeights={rankingWeights}
            showRanking={limits.ranking}
            showCompare={limits.compareMode}
            autoSelectBest={runner.autoSelectBest}
            activeTab={resultsTab}
            onTabChange={handleTabChange}
            socialContent={
              <Suspense fallback={<div style={{ padding: 20, color: "var(--color-text-muted)" }}>Loading...</div>}>
                <SocialVariantsPanel
                  status={social.status}
                  variants={social.variants}
                  images={social.images}
                  error={social.error}
                  selectedPlatforms={platformTarget}
                  onPlatformChange={setPlatformTarget}
                  onGenerate={handleGenerateSocial}
                />
              </Suspense>
            }
            exportContent={
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Link
                  href="/canvas"
                  onClick={(e) => {
                    if (process.env.NODE_ENV !== "production") console.log("[OpenCanvas] clicked", { path: window.location.pathname });
                    if (!hasCompletedResults || !prompt.trim()) {
                      e.preventDefault();
                      return;
                    }
                    if (process.env.NODE_ENV !== "production") console.log("[OpenCanvas] navigating to /canvas");
                    seedCanvasData();
                  }}
                  aria-disabled={!hasCompletedResults || !prompt.trim()}
                  tabIndex={hasCompletedResults && prompt.trim() ? 0 : -1}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: "1px solid var(--color-border)",
                    backgroundColor: "transparent",
                    color: hasCompletedResults && prompt.trim() ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                    cursor: hasCompletedResults && prompt.trim() ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    textDecoration: "none",
                    pointerEvents: hasCompletedResults && prompt.trim() ? "auto" : "none",
                  }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Open Canvas Editor
                </Link>
                <Suspense fallback={null}>
                  <ExportButton
                    status={exporter.status}
                    error={exporter.error}
                    disabled={!hasCompletedResults || !prompt.trim()}
                    onExport={handleExport}
                    onReset={exporter.reset}
                  />
                </Suspense>
              </div>
            }
            onOpenCanvas={seedCanvasData}
            onToggleAutoSelect={() => runner.setAutoSelectBest((v: boolean) => !v)}
            onSelectWinner={runner.selectWinner}
            onCompare={() => setShowCompare(true)}
          />
        </Suspense>
      )}

      {/* Compare modal (Pro only) */}
      {limits.compareMode && showCompare && (
        <Suspense fallback={null}>
          <CompareModal
            results={runner.results}
            prompt={prompt}
            onClose={() => setShowCompare(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Fallback variants seeded from prompt text when the social-format API is unavailable. */
function buildMinimalVariants(caption: string) {
  return {
    instagram: { caption, hashtags: [] },
    tiktok: { caption, hashtags: [] },
    x: { caption },
    linkedin: { caption },
    youtubeShorts: { title: caption.slice(0, 100), description: caption, hashtags: [] },
  };
}
