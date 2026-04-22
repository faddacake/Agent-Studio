"use client";

import { useState } from "react";

// ── Inline graph definitions ──────────────────────────────────────────────────
// These mirror the STARTER_GRAPHS in workflows/page.tsx.  They are intentionally
// duplicated here so this component is self-contained and can be moved or reused
// without pulling in the whole page module.

const QUICK_SOCIAL_REEL_GRAPH = {
  version: 1,
  nodes: [
    { id: "qsr-1", type: "prompt-template",  data: { label: "Scene Prompt",       params: { template: "A cinematic {{style}} shot of {{subject}}, high quality, vivid colors" } }, position: { x: 80,  y: 160 } },
    { id: "qsr-2", type: "image-generation", data: { label: "Image Generation",   params: { width: 576, height: 1024, num_inference_steps: 28, guidance_scale: 7.5, seed: -1 } }, position: { x: 380, y: 160 } },
    { id: "qsr-3", type: "video-generation", data: { label: "Video Generation",   params: { duration: 5, resolution: "720p", seed: -1 } }, position: { x: 700, y: 160 } },
  ],
  edges: [
    { id: "qsr-e1", source: "qsr-1", target: "qsr-2", sourceHandle: "text_out",  targetHandle: "prompt_in" },
    { id: "qsr-e2", source: "qsr-1", target: "qsr-3", sourceHandle: "text_out",  targetHandle: "prompt_in" },
    { id: "qsr-e3", source: "qsr-2", target: "qsr-3", sourceHandle: "image_out", targetHandle: "image_in"  },
  ],
};

const PRODUCT_PROMO_GRAPH = {
  version: 1,
  nodes: [
    { id: "pp-1", type: "prompt-template", data: { label: "Product Prompt",       params: { template: "A professional product photo of {{product}}, studio lighting, clean background" } }, position: { x: 80,   y: 160 } },
    { id: "pp-2", type: "best-of-n",       data: { label: "Best of N (4 variants)", params: { n: 4, k: 1, provider: "mock", model: "mock-sdxl" } },                                         position: { x: 380,  y: 160 } },
    { id: "pp-3", type: "social-format",   data: { label: "Social Format",         params: { platforms: ["instagram", "x", "linkedin"], tone: "professional", includeHashtags: true, includeCTA: true } }, position: { x: 700,  y: 160 } },
    { id: "pp-4", type: "export-bundle",   data: { label: "Export Bundle",         params: { format: "manifest-only", includeImages: true, includeMetadata: true, includeSocialText: true, includeScores: true } }, position: { x: 1020, y: 160 } },
  ],
  edges: [
    { id: "pp-e1", source: "pp-1", target: "pp-2", sourceHandle: "text_out",      targetHandle: "prompt_in"     },
    { id: "pp-e2", source: "pp-2", target: "pp-3", sourceHandle: "selection_out", targetHandle: "candidates_in" },
    { id: "pp-e3", source: "pp-3", target: "pp-4", sourceHandle: "formatted_out", targetHandle: "candidates_in" },
  ],
};

const STORY_HIGHLIGHT_GRAPH = {
  version: 1,
  nodes: [
    { id: "sh-1", type: "prompt-template",  data: { label: "Scene Prompt",      params: { template: "A {{mood}} scene of {{setting}}, cinematic lighting, wide shot" } }, position: { x: 80,  y: 200 } },
    { id: "sh-2", type: "image-generation", data: { label: "Scene A — Image",   params: { width: 1280, height: 720, seed: 42 } }, position: { x: 380, y: 60  } },
    { id: "sh-3", type: "video-generation", data: { label: "Scene A — Video",   params: { duration: 5, resolution: "720p", seed: 42 } }, position: { x: 700, y: 60  } },
    { id: "sh-4", type: "image-generation", data: { label: "Scene B — Image",   params: { width: 1280, height: 720, seed: 99 } }, position: { x: 380, y: 340 } },
    { id: "sh-5", type: "video-generation", data: { label: "Scene B — Video",   params: { duration: 5, resolution: "720p", seed: 99 } }, position: { x: 700, y: 340 } },
  ],
  edges: [
    { id: "sh-e1", source: "sh-1", target: "sh-2", sourceHandle: "text_out",  targetHandle: "prompt_in" },
    { id: "sh-e2", source: "sh-1", target: "sh-4", sourceHandle: "text_out",  targetHandle: "prompt_in" },
    { id: "sh-e3", source: "sh-2", target: "sh-3", sourceHandle: "image_out", targetHandle: "image_in"  },
    { id: "sh-e4", source: "sh-4", target: "sh-5", sourceHandle: "image_out", targetHandle: "image_in"  },
  ],
};

interface WelcomeTemplate {
  key: string;
  icon: string;
  name: string;
  description: string;
  nodeCount: number;
  graph: object;
}

const WELCOME_TEMPLATES: WelcomeTemplate[] = [
  {
    key: "quick-social-reel",
    icon: "🎬",
    name: "Quick Social Reel",
    description: "Prompt → 9:16 image → 5s video clip. Fastest path to a vertical reel.",
    nodeCount: 3,
    graph: QUICK_SOCIAL_REEL_GRAPH,
  },
  {
    key: "product-promo",
    icon: "📦",
    name: "Product Promo",
    description: "Generate 4 image variants, score the best, add social captions, and export.",
    nodeCount: 4,
    graph: PRODUCT_PROMO_GRAPH,
  },
  {
    key: "story-highlight",
    icon: "🎞",
    name: "Story Highlight",
    description: "Two parallel scene tracks (A & B), each image → video, driven by one prompt.",
    nodeCount: 5,
    graph: STORY_HIGHLIGHT_GRAPH,
  },
];

// ── Pipeline diagram ──────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { icon: "✏️", label: "Prompt" },
  { icon: "🖼", label: "Image" },
  { icon: "🎬", label: "Video" },
  { icon: "📤", label: "Export" },
] as const;

function PipelineDiagram() {
  return (
    <div
      role="img"
      aria-label="Core workflow loop: Prompt to Image to Video to Export"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        padding: "20px 32px",
        backgroundColor: "var(--color-bg-primary)",
        borderRadius: 10,
        border: "1px solid var(--color-border)",
        overflowX: "auto",
      }}
    >
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
          {/* Node box */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "10px 16px",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              backgroundColor: "var(--color-surface)",
              minWidth: 72,
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">
              {step.icon}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              {step.label}
            </span>
          </div>
          {/* Connector arrow (not after last step) */}
          {i < PIPELINE_STEPS.length - 1 && (
            <div
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 4px",
              }}
            >
              <div style={{ width: 28, height: 1, backgroundColor: "var(--color-accent)", opacity: 0.5 }} />
              <span style={{ color: "var(--color-accent)", fontSize: 12, marginLeft: -1, opacity: 0.7 }}>▶</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  tpl,
  onUse,
  loading,
}: {
  tpl: WelcomeTemplate;
  onUse: (tpl: WelcomeTemplate) => void;
  loading: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        padding: "18px 20px",
        border: `1px solid ${hovered ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: 10,
        backgroundColor: hovered ? "var(--color-surface-hover)" : "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color 0.15s, background-color 0.15s",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }} aria-hidden="true">{tpl.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {tpl.name}
        </span>
      </div>

      {/* Description */}
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5, margin: 0, flexGrow: 1 }}>
        {tpl.description}
      </p>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {tpl.nodeCount} nodes
        </span>
        <button
          onClick={() => onUse(tpl)}
          disabled={loading}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
          aria-label={`Use ${tpl.name} template`}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            borderRadius: 6,
            cursor: loading ? "default" : "pointer",
            backgroundColor: btnHovered && !loading ? "var(--color-accent-hover)" : "var(--color-accent)",
            color: "#fff",
            opacity: loading ? 0.6 : 1,
            transition: "background-color 0.12s, opacity 0.12s",
          }}
        >
          {loading ? "Creating…" : "Use →"}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface WelcomeScreenProps {
  /** Called when the user picks a template or the quick-start CTA. Creates the
   *  workflow and navigates; does not need to return to this screen on success. */
  onCreateFromGraph: (graph: object, name: string) => Promise<void>;
  /** Open the New Workflow modal so the user can browse all starters/templates. */
  onOpenModal: () => void;
  /** Dismiss the welcome screen and show the normal empty state instead. */
  onDismiss: () => void;
  /** True while a workflow creation request is in flight. */
  creating: boolean;
}

export function WelcomeScreen({ onCreateFromGraph, onOpenModal, onDismiss, creating }: WelcomeScreenProps) {
  // Track which template key is actively being created so we show a per-button spinner.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dismissHovered, setDismissHovered] = useState(false);
  const [quickReelHovered, setQuickReelHovered] = useState(false);
  const [browseHovered, setBrowseHovered] = useState(false);
  const [blankHovered, setBlankHovered] = useState(false);

  async function handleUseTemplate(tpl: WelcomeTemplate) {
    if (creating) return;
    setActiveKey(tpl.key);
    try {
      await onCreateFromGraph(tpl.graph, tpl.name);
    } finally {
      // Only reached on error — navigation unmounts on success.
      setActiveKey(null);
    }
  }

  async function handleQuickReel() {
    if (creating) return;
    setActiveKey("quick-social-reel");
    try {
      await onCreateFromGraph(QUICK_SOCIAL_REEL_GRAPH, "Quick Social Reel");
    } finally {
      setActiveKey(null);
    }
  }

  return (
    <section
      aria-labelledby="welcome-heading"
      style={{
        position: "relative",
        borderRadius: 14,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        padding: "40px 40px 36px",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {/* ── Dismiss button ── */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss welcome screen"
        onMouseEnter={() => setDismissHovered(true)}
        onMouseLeave={() => setDismissHovered(false)}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          cursor: "pointer",
          color: dismissHovered ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          fontSize: 14,
          lineHeight: 1,
          transition: "color 0.12s",
        }}
      >
        ×
      </button>

      {/* ── Hero ── */}
      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden="true">🎬</div>
        <h1
          id="welcome-heading"
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "var(--color-text-primary)",
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          Welcome to AI Studio
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-muted)", margin: 0 }}>
          Build&nbsp;·&nbsp;Generate&nbsp;·&nbsp;Edit&nbsp;·&nbsp;Export&nbsp;multimodal&nbsp;videos
        </p>
      </div>

      {/* ── Pipeline diagram ── */}
      <div style={{ marginBottom: 28 }}>
        <PipelineDiagram />
      </div>

      {/* ── Primary CTAs ── */}
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "center",
          marginBottom: 36,
          flexWrap: "wrap",
        }}
      >
        {/* Primary: Quick Social Reel */}
        <button
          onClick={handleQuickReel}
          disabled={creating}
          onMouseEnter={() => setQuickReelHovered(true)}
          onMouseLeave={() => setQuickReelHovered(false)}
          aria-label="Create a Quick Social Reel workflow"
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            borderRadius: 8,
            cursor: creating ? "default" : "pointer",
            backgroundColor: quickReelHovered && !creating ? "var(--color-accent-hover)" : "var(--color-accent)",
            color: "#fff",
            opacity: creating ? 0.7 : 1,
            transition: "background-color 0.12s",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span aria-hidden="true">🎬</span>
          {activeKey === "quick-social-reel" ? "Creating…" : "Try Quick Social Reel"}
        </button>

        {/* Secondary: Browse all templates */}
        <button
          onClick={onOpenModal}
          disabled={creating}
          onMouseEnter={() => setBrowseHovered(true)}
          onMouseLeave={() => setBrowseHovered(false)}
          aria-label="Browse all workflow templates"
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            cursor: creating ? "default" : "pointer",
            backgroundColor: browseHovered && !creating ? "var(--color-surface-hover)" : "var(--color-surface)",
            color: "var(--color-text-secondary)",
            opacity: creating ? 0.7 : 1,
            transition: "background-color 0.12s",
          }}
        >
          Browse All Templates
        </button>

        {/* Tertiary: Blank workflow */}
        <button
          onClick={onOpenModal}
          disabled={creating}
          onMouseEnter={() => setBlankHovered(true)}
          onMouseLeave={() => setBlankHovered(false)}
          aria-label="Create a blank workflow"
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            cursor: creating ? "default" : "pointer",
            backgroundColor: blankHovered && !creating ? "var(--color-surface-hover)" : "transparent",
            color: "var(--color-text-muted)",
            opacity: creating ? 0.7 : 1,
            transition: "background-color 0.12s",
          }}
        >
          + Create Blank
        </button>
      </div>

      {/* ── Featured template cards ── */}
      <div>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--color-text-muted)",
            marginBottom: 12,
          }}
          aria-hidden="true"
        >
          Featured Templates
        </p>
        <div
          role="list"
          aria-label="Featured workflow templates"
          style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
        >
          {WELCOME_TEMPLATES.map((tpl) => (
            <div key={tpl.key} role="listitem" style={{ flex: "1 1 200px", minWidth: 0 }}>
              <TemplateCard
                tpl={tpl}
                onUse={handleUseTemplate}
                loading={activeKey === tpl.key}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
