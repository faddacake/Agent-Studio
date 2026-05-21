"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// ── Artifact cleanup helpers ──────────────────────────────────────────────────

type CleanupResult = {
  deleted: string[];
  skipped: string[];
  dryRun: boolean;
  freedBytes: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UsageInfo = { totalBytes: number; runCount: number };

function ArtifactCleanupSection() {
  const [olderThanDays, setOlderThanDays] = useState("30");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  useEffect(() => {
    fetch("/api/admin/artifacts/cleanup")
      .then((r) => r.ok ? r.json() as Promise<UsageInfo> : Promise.reject())
      .then(setUsage)
      .catch(() => {/* non-fatal */});
  }, []);

  async function runCleanup(dryRun: boolean) {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const days = olderThanDays.trim() ? Number(olderThanDays) : undefined;
      const body: Record<string, unknown> = { dryRun };
      if (days != null && !isNaN(days) && days > 0) body.olderThanDays = days;

      const res = await fetch("/api/admin/artifacts/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as CleanupResult;
      setResult(data);

      // Refresh usage after a real deletion
      if (!dryRun && data.deleted.length > 0) {
        fetch("/api/admin/artifacts/cleanup")
          .then((r) => r.ok ? r.json() as Promise<UsageInfo> : Promise.reject())
          .then(setUsage)
          .catch(() => {/* non-fatal */});
      }
    } catch {
      setError("Cleanup request failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Current usage summary */}
      <div style={{
        padding: "10px 14px",
        backgroundColor: "var(--color-bg-primary)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        fontSize: 13,
        color: "var(--color-text-secondary)",
      }}>
        {usage === null ? (
          <span>Calculating storage usage…</span>
        ) : usage.runCount === 0 ? (
          <span>No artifact directories — storage is empty.</span>
        ) : (
          <span>
            <strong style={{ color: "var(--color-text-primary)" }}>{formatBytes(usage.totalBytes)}</strong>
            {" used across "}
            <strong style={{ color: "var(--color-text-primary)" }}>{usage.runCount}</strong>
            {usage.runCount === 1 ? " run directory" : " run directories"}
          </span>
        )}
      </div>

      <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
        Remove artifact directories (generated images) for runs that are orphaned or older than a
        specified age. Orphaned means the run directory has no matching run record in the database.
      </p>

      <label style={{ display: "block" }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>
          Also delete runs older than (days) — leave blank for orphans only
        </span>
        <input
          type="number"
          min={1}
          value={olderThanDays}
          onChange={(e) => setOlderThanDays(e.target.value)}
          placeholder="e.g. 30"
          style={{
            width: 120,
            padding: "8px 10px",
            backgroundColor: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-text-primary)",
            fontSize: 14,
            outline: "none",
          }}
        />
      </label>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => runCleanup(true)}
          disabled={running}
          style={{
            padding: "8px 16px",
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-text-secondary)",
            fontSize: 13,
            fontWeight: 500,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Running…" : "Preview (dry run)"}
        </button>
        <button
          onClick={() => runCleanup(false)}
          disabled={running}
          style={{
            padding: "8px 16px",
            backgroundColor: running ? "var(--color-surface)" : "var(--color-error, #ef4444)",
            border: "none",
            borderRadius: 8,
            color: running ? "var(--color-text-muted)" : "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Running…" : "Delete artifacts"}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "var(--color-error)", margin: 0 }}>{error}</p>
      )}

      {result && (
        <div style={{
          padding: "12px 14px",
          backgroundColor: "var(--color-bg-primary)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          fontSize: 13,
        }}>
          {result.dryRun && (
            <p style={{ color: "var(--color-text-secondary)", marginBottom: 6, fontWeight: 600 }}>
              Dry run — no files were deleted.
            </p>
          )}
          {result.deleted.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", margin: 0 }}>Nothing to clean up.</p>
          ) : (
            <>
              <p style={{ color: "var(--color-text-primary)", margin: "0 0 6px" }}>
                {result.dryRun ? "Would delete" : "Deleted"} {result.deleted.length}{" "}
                {result.deleted.length === 1 ? "run directory" : "run directories"}{" "}
                ({formatBytes(result.freedBytes)} freed).
              </p>
              <details>
                <summary style={{ cursor: "pointer", color: "var(--color-text-muted)", fontSize: 12 }}>
                  Show run IDs
                </summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "var(--color-text-muted)", fontSize: 11 }}>
                  {result.deleted.map((id) => <li key={id}>{id}</li>)}
                </ul>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleChangePassword() {
    setPwMsg(null);
    if (newPw.length < 8) {
      setPwMsg({ type: "error", text: "New password must be at least 8 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ type: "error", text: "New passwords do not match." });
      return;
    }

    setSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });

    if (res.ok) {
      setPwMsg({ type: "success", text: "Password changed successfully." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } else {
      const data = await res.json();
      setPwMsg({ type: "error", text: data.message || "Failed to change password." });
    }
    setSaving(false);
  }

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 32 }}>
        Settings
      </h1>

      {/* Provider API Keys */}
      <Section title="AI Providers">
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 12 }}>
          Configure API keys for your AI providers to start generating content.
        </p>
        <Link
          href="/settings/providers"
          style={{
            display: "inline-block",
            padding: "9px 18px",
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-text-primary)",
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
            transition: "background-color 100ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-surface)";
          }}
        >
          Manage Providers
        </Link>
      </Section>

      {/* Change Password */}
      <Section title="Change Password">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <InputField
            label="Current Password"
            type="password"
            value={currentPw}
            onChange={setCurrentPw}
            placeholder="Enter current password"
          />
          <InputField
            label="New Password"
            type="password"
            value={newPw}
            onChange={setNewPw}
            placeholder="Minimum 8 characters"
          />
          <InputField
            label="Confirm New Password"
            type="password"
            value={confirmPw}
            onChange={setConfirmPw}
            placeholder="Re-enter new password"
          />
          {pwMsg && (
            <p
              style={{
                fontSize: 13,
                color: pwMsg.type === "success" ? "var(--color-success)" : "var(--color-error)",
              }}
            >
              {pwMsg.text}
            </p>
          )}
          <div>
            <button
              onClick={handleChangePassword}
              disabled={saving || !currentPw || !newPw || !confirmPw}
              style={{
                padding: "9px 18px",
                backgroundColor:
                  currentPw && newPw && confirmPw ? "var(--color-accent)" : "var(--color-surface)",
                border: "none",
                borderRadius: 8,
                color: currentPw && newPw && confirmPw ? "#fff" : "var(--color-text-muted)",
                fontSize: 14,
                fontWeight: 600,
                cursor: currentPw && newPw && confirmPw ? "pointer" : "default",
              }}
            >
              {saving ? "Saving..." : "Update Password"}
            </button>
          </div>
        </div>
      </Section>

      {/* Storage */}
      <Section title="Storage">
        <ArtifactCleanupSection />
      </Section>

      {/* About */}
      <Section title="About">
        <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
          <p><strong style={{ color: "var(--color-text-primary)" }}>Agent Studio</strong></p>
          <p>Self-hosted AI workflow builder</p>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 28,
        padding: 20,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
      }}
    >
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          marginBottom: 14,
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function InputField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "10px 12px",
          backgroundColor: "var(--color-bg-primary)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          color: "var(--color-text-primary)",
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}
