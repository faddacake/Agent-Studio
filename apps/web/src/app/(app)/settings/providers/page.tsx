"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface ProviderConfig {
  id: string;
  validatedAt: string | null;
  createdAt: string;
}

interface ProviderMeta {
  id: string;
  label: string;
  icon: string;
  group: string;
  description: string;
  models: string;
  docsUrl: string;
  keyPlaceholder: string;
  keyLabel?: string; // defaults to "API Key"
}

const PROVIDERS: ProviderMeta[] = [
  // ── Image & Video Generation ────────────────────────────────────────────
  {
    id: "fal",
    label: "Fal.ai",
    icon: "⚡",
    group: "Image & Video Generation",
    description: "Fast inference for FLUX, Stable Diffusion, Kling video, and hundreds of community models.",
    models: "FLUX.1 · Kling 1.6 · SD XL · AnimateDiff · CogVideoX",
    docsUrl: "https://fal.ai/dashboard/keys",
    keyPlaceholder: "fal-...",
  },
  {
    id: "replicate",
    label: "Replicate",
    icon: "🔁",
    group: "Image & Video Generation",
    description: "Run thousands of open-source models via API — image, video, audio, and text generation.",
    models: "SDXL · FLUX · Llama 3 · Whisper · MusicGen",
    docsUrl: "https://replicate.com/account/api-tokens",
    keyPlaceholder: "r8_...",
  },
  {
    id: "stability",
    label: "Stability AI",
    icon: "🎨",
    group: "Image & Video Generation",
    description: "Stable Diffusion 3, SDXL, and Stable Video — direct access to Stability's hosted inference.",
    models: "Stable Diffusion 3 · SDXL · Stable Video Diffusion",
    docsUrl: "https://platform.stability.ai/account/keys",
    keyPlaceholder: "sk-...",
  },
  {
    id: "midjourney",
    label: "Midjourney",
    icon: "🖼",
    group: "Image & Video Generation",
    description: "High-quality artistic image generation via the Midjourney API gateway.",
    models: "Midjourney v6 · v6.1",
    docsUrl: "https://www.midjourney.com/account",
    keyPlaceholder: "Bearer token...",
  },
  // ── Language Models ──────────────────────────────────────────────────────
  {
    id: "openai",
    label: "OpenAI",
    icon: "✦",
    group: "Language Models",
    description: "GPT-4o, o1, and the full OpenAI model family for text, vision, and structured outputs.",
    models: "GPT-4o · GPT-4o mini · o1 · o3-mini",
    docsUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "◆",
    group: "Language Models",
    description: "Claude 3.5 Sonnet, Haiku, and Opus — top-tier reasoning, writing, and code generation.",
    models: "Claude 3.5 Sonnet · Claude 3.5 Haiku · Claude 3 Opus",
    docsUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    icon: "✕",
    group: "Language Models",
    description: "xAI's Grok models with real-time knowledge and advanced reasoning capabilities.",
    models: "Grok-2 · Grok-2 Vision · Grok-3",
    docsUrl: "https://console.x.ai",
    keyPlaceholder: "xai-...",
  },
  {
    id: "ollama",
    label: "Ollama",
    icon: "🦙",
    group: "Language Models",
    description:
      "Run open-source models on your own hardware. Enter the base URL of your Ollama server.",
    models: "Llama 3 · Mistral · Gemma 2 · Phi-3 · Code Llama",
    docsUrl: "https://ollama.com",
    keyPlaceholder: "http://localhost:11434",
    keyLabel: "Server URL",
  },
  // ── Multimodal ───────────────────────────────────────────────────────────
  {
    id: "google",
    label: "Google AI",
    icon: "◉",
    group: "Multimodal",
    description:
      "Gemini 2.0 Flash, Gemini 1.5 Pro, and Imagen for text, vision, and image generation.",
    models: "Gemini 2.0 Flash · Gemini 1.5 Pro · Imagen 3",
    docsUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIza...",
  },
  // ── Voice & Audio ────────────────────────────────────────────────────────
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    icon: "🔊",
    group: "Voice & Audio",
    description: "Hyper-realistic voice synthesis, voice cloning, and multilingual dubbing.",
    models: "Multilingual v2 · Turbo v2.5 · Voice Design",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    keyPlaceholder: "xi-...",
  },
  // ── Cloud Providers ──────────────────────────────────────────────────────
  {
    id: "bedrock",
    label: "AWS Bedrock",
    icon: "☁",
    group: "Cloud Providers",
    description:
      "Claude, Llama, Amazon Titan, and Mistral via AWS infrastructure. Format: ACCESS_KEY:SECRET:REGION",
    models: "Claude 3 · Llama 3 · Amazon Titan · Mistral",
    docsUrl: "https://console.aws.amazon.com/iam",
    keyPlaceholder: "AKIA...:wJalrXUt...:us-east-1",
    keyLabel: "Access Key:Secret:Region",
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    icon: "◈",
    group: "Cloud Providers",
    description:
      "OpenAI models on Microsoft Azure for enterprise compliance and data residency. Format: ENDPOINT|KEY",
    models: "GPT-4o · GPT-4 Turbo · DALL-E 3",
    docsUrl: "https://portal.azure.com",
    keyPlaceholder: "https://my-resource.openai.azure.com|abc123...",
    keyLabel: "Endpoint|API Key",
  },
];

const PROVIDER_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Image & Video Generation", ids: ["fal", "replicate", "stability", "midjourney"] },
  { label: "Language Models", ids: ["openai", "anthropic", "grok", "ollama"] },
  { label: "Multimodal", ids: ["google"] },
  { label: "Voice & Audio", ids: ["elevenlabs"] },
  { label: "Cloud Providers", ids: ["bedrock", "azure"] },
];

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export default function ProvidersPage() {
  const [configs, setConfigs] = useState<Record<string, ProviderConfig>>({});
  const [loading, setLoading] = useState(true);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data: ProviderConfig[] = await res.json();
        const map: Record<string, ProviderConfig> = {};
        for (const c of data) map[c.id] = c;
        setConfigs(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const configuredCount = Object.keys(configs).length;

  return (
    <div style={{ padding: "32px 40px", maxWidth: 900 }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 8 }}>
        <Link
          href="/settings"
          style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "none" }}
        >
          ← Settings
        </Link>
      </div>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "var(--color-text-primary)",
            marginBottom: 6,
          }}
        >
          AI Providers
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          Add API keys to enable generation. Keys are encrypted at rest with AES-256-GCM.
          {configuredCount > 0 && (
            <span
              style={{
                marginLeft: 10,
                fontSize: 12,
                fontWeight: 600,
                padding: "2px 10px",
                borderRadius: 20,
                backgroundColor: "rgba(34,197,94,0.12)",
                color: "var(--color-success)",
              }}
            >
              {configuredCount} configured
            </span>
          )}
        </p>
      </div>

      {loading ? (
        <p style={{ fontSize: 14, color: "var(--color-text-muted)" }}>Loading...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          {PROVIDER_GROUPS.map((group) => (
            <section key={group.label}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {group.label}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {group.ids.map((id) => {
                  const provider = PROVIDER_MAP[id];
                  if (!provider) return null;
                  return (
                    <ProviderCard
                      key={id}
                      provider={provider}
                      config={configs[id] ?? null}
                      onSaved={fetchConfigs}
                      onRemoved={fetchConfigs}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Provider Card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  config,
  onSaved,
  onRemoved,
}: {
  provider: ProviderMeta;
  config: ProviderConfig | null;
  onSaved: () => void;
  onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preTesting, setPreTesting] = useState(false);
  const [preTestResult, setPreTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isConfigured = config !== null;
  const keyLabel = provider.keyLabel ?? "API Key";

  async function handleSave() {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    setPreTestResult(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (res.ok) {
        setApiKey("");
        setEditing(false);
        onSaved();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Failed to save — please try again");
      }
    } catch {
      setError("Connection error — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreTest() {
    if (!apiKey.trim() || preTesting) return;
    setPreTesting(true);
    setPreTestResult(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setPreTestResult({ ok: true, message: "Key accepted — click Save to store it" });
      } else {
        setPreTestResult({ ok: false, message: data.message || "Validation failed" });
      }
    } catch {
      setPreTestResult({ ok: false, message: "Network error — please try again" });
    } finally {
      setPreTesting(false);
    }
  }

  async function handleRemove() {
    if (removing) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
      if (res.ok) {
        setEditing(false);
        setApiKey("");
        onRemoved();
      } else {
        setError("Failed to remove — please try again");
      }
    } catch {
      setError("Connection error — please try again");
    } finally {
      setRemoving(false);
    }
  }

  function handleCancel() {
    setEditing(false);
    setApiKey("");
    setError(null);
    setPreTestResult(null);
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/validate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setTestResult({ ok: true, message: "Connection successful" });
        onSaved();
      } else {
        setTestResult({ ok: false, message: data.message || "Validation failed" });
      }
    } catch {
      setTestResult({ ok: false, message: "Network error — please try again" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      style={{
        padding: "18px 20px",
        backgroundColor: "var(--color-surface)",
        border: `1px solid ${isConfigured ? "var(--color-success)" : "var(--color-border)"}`,
        borderRadius: 10,
        transition: "border-color 200ms ease",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{provider.icon}</span>
          <span
            style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}
          >
            {provider.label}
          </span>
          {isConfigured ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 6,
                backgroundColor: "rgba(34,197,94,0.12)",
                color: "var(--color-success)",
              }}
            >
              Configured
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: 6,
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              Not configured
            </span>
          )}
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: "var(--color-text-muted)", textDecoration: "none" }}
        >
          Get {keyLabel} ↗
        </a>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
          lineHeight: 1.5,
        }}
      >
        {provider.description}
      </p>

      {/* Model pills */}
      <div style={{ marginBottom: 14 }}>
        {provider.models.split(" · ").map((model) => (
          <span
            key={model}
            style={{
              display: "inline-block",
              fontSize: 11,
              padding: "2px 8px",
              marginRight: 5,
              marginBottom: 4,
              borderRadius: 4,
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            {model}
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 6,
            backgroundColor: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 13,
            color: "var(--color-error)",
          }}
        >
          {error}
        </div>
      )}

      {/* Key input — shown when unconfigured or editing */}
      {(!isConfigured || editing) && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ marginBottom: 6 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-muted)",
              }}
            >
              {keyLabel}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setPreTestResult(null);
              }}
              placeholder={provider.keyPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              style={{
                flex: 1,
                padding: "9px 12px",
                backgroundColor: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-text-primary)",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handlePreTest}
              disabled={!apiKey.trim() || preTesting}
              title={`Test this ${keyLabel.toLowerCase()} before saving`}
              style={{
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 13,
                border: "1px solid var(--color-accent)",
                backgroundColor: "transparent",
                color:
                  !apiKey.trim() || preTesting
                    ? "var(--color-text-muted)"
                    : "var(--color-accent)",
                cursor: apiKey.trim() && !preTesting ? "pointer" : "default",
                whiteSpace: "nowrap",
              }}
            >
              {preTesting ? "Testing…" : "Test"}
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                backgroundColor: apiKey.trim()
                  ? "var(--color-accent)"
                  : "var(--color-surface-hover)",
                color: apiKey.trim() ? "#fff" : "var(--color-text-muted)",
                cursor: apiKey.trim() ? "pointer" : "default",
                whiteSpace: "nowrap",
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {editing && (
              <button
                onClick={handleCancel}
                style={{
                  padding: "9px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "transparent",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {preTestResult && (
            <div
              style={{
                marginTop: 8,
                padding: "7px 12px",
                borderRadius: 6,
                fontSize: 13,
                border: `1px solid ${preTestResult.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                backgroundColor: preTestResult.ok
                  ? "rgba(34,197,94,0.08)"
                  : "rgba(239,68,68,0.08)",
                color: preTestResult.ok ? "var(--color-success)" : "var(--color-error)",
              }}
            >
              {preTestResult.ok ? "✓ " : "✗ "}
              {preTestResult.message}
            </div>
          )}
        </div>
      )}

      {/* Configured state actions */}
      {isConfigured && !editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: "7px 14px",
                borderRadius: 7,
                fontSize: 13,
                border: "1px solid var(--color-accent)",
                backgroundColor: "transparent",
                color: testing ? "var(--color-text-muted)" : "var(--color-accent)",
                cursor: testing ? "default" : "pointer",
              }}
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
            <button
              onClick={() => {
                setEditing(true);
                setError(null);
                setTestResult(null);
              }}
              style={{
                padding: "7px 14px",
                borderRadius: 7,
                fontSize: 13,
                border: "1px solid var(--color-border)",
                backgroundColor: "transparent",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              Update {keyLabel}
            </button>
            <button
              onClick={handleRemove}
              disabled={removing}
              style={{
                padding: "7px 14px",
                borderRadius: 7,
                fontSize: 13,
                border: "1px solid rgba(239,68,68,0.3)",
                backgroundColor: "transparent",
                color: removing ? "var(--color-text-muted)" : "var(--color-error)",
                cursor: removing ? "default" : "pointer",
              }}
            >
              {removing ? "Removing..." : "Remove"}
            </button>
            {config?.validatedAt && !testResult && (
              <span
                style={{ fontSize: 12, color: "var(--color-text-muted)", alignSelf: "center" }}
              >
                Validated {new Date(config.validatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {testResult && (
            <div
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                fontSize: 13,
                border: `1px solid ${testResult.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                backgroundColor: testResult.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                color: testResult.ok ? "var(--color-success)" : "var(--color-error)",
              }}
            >
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
