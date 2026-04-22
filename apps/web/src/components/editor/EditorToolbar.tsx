"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { AspectRatio } from "@/lib/editorProjectTypes";
import { ExportStatusPanel } from "./ExportStatusPanel";
import type { ExportJobStatusResponse } from "@/lib/exportJobStatus";
import type { ExportJobHookState, ExportMode } from "@/hooks/useExportJob";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface EditorToolbarProps {
  projectId: string;
  name: string;
  aspectRatio: AspectRatio;
  saveState: SaveState;
  isDirty: boolean;
  onNameChange: (name: string) => void;
  onAspectRatioChange: (ar: AspectRatio) => void;
  onSave: () => void;
  // ── Export status ──────────────────────────────────────────────────────────
  exportState: ExportJobHookState;
  exportJobStatus: ExportJobStatusResponse | null;
  exportError: string | null;
  exportMode: ExportMode | null;
  startedAt: number | null;
  onExport: () => void;
  onPreview: () => void;
  onExportReset: () => void;
  /** Total video duration in ms — passed through to ExportStatusPanel for pre-export cost estimate. */
  projectDurationMs?: number;
  /** True when an audio/voiceover track is attached — shown as a badge near the export controls. */
  hasAudio?: boolean;
}

const ASPECT_RATIO_LABEL: Record<AspectRatio, string> = {
  "16:9": "16:9 Landscape",
  "9:16": "9:16 Portrait",
  "1:1":  "1:1 Square",
};

const SAVE_LABEL: Record<SaveState, string> = {
  idle:   "Save",
  saving: "Saving…",
  saved:  "Saved",
  error:  "Save failed — retry",
};

const ASPECT_RATIOS: AspectRatio[] = ["16:9", "9:16", "1:1"];

export function EditorToolbar({
  name,
  aspectRatio,
  saveState,
  isDirty,
  onNameChange,
  onAspectRatioChange,
  onSave,
  exportState,
  exportJobStatus,
  exportError,
  exportMode,
  startedAt,
  onExport,
  onPreview,
  onExportReset,
  projectDurationMs,
  hasAudio,
}: EditorToolbarProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  function commitName() {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== name) onNameChange(trimmed);
    else setNameInput(name); // revert if empty or unchanged
    setEditingName(false);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 16px",
        height: 48,
        borderBottom: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        flexShrink: 0,
      }}
    >
      {/* Back link */}
      <Link
        href="/workflows"
        style={{
          fontSize: 13,
          color: "var(--color-text-muted)",
          textDecoration: "none",
          flexShrink: 0,
        }}
        title="Back to Workflows"
      >
        ← Workflows
      </Link>

      <span style={{ color: "var(--color-border)", flexShrink: 0 }}>/</span>

      {/* Project name — click to edit inline */}
      {editingName ? (
        <input
          ref={nameInputRef}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") { setNameInput(name); setEditingName(false); }
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-accent)",
            borderRadius: 4,
            padding: "2px 8px",
            outline: "none",
            minWidth: 120,
            maxWidth: 280,
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setNameInput(name); setEditingName(true); }}
          title="Click to rename project"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            background: "none",
            border: "none",
            padding: "2px 4px",
            cursor: "pointer",
            borderRadius: 4,
            maxWidth: 280,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
          {isDirty && (
            <span
              style={{ color: "var(--color-text-muted)", fontWeight: 400, marginLeft: 4 }}
              title="Unsaved changes"
            >
              ●
            </span>
          )}
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Aspect ratio selector */}
      <select
        value={aspectRatio}
        onChange={(e) => onAspectRatioChange(e.target.value as AspectRatio)}
        title="Change aspect ratio"
        style={{
          fontSize: 11,
          color: "var(--color-text-muted)",
          padding: "2px 6px",
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          background: "var(--color-bg-secondary)",
          cursor: "pointer",
          flexShrink: 0,
          outline: "none",
        }}
      >
        {ASPECT_RATIOS.map((ar) => (
          <option key={ar} value={ar}>
            {ASPECT_RATIO_LABEL[ar]}
          </option>
        ))}
      </select>

      {/* Audio track indicator — visible when a voiceover/audio track is attached */}
      {hasAudio && (
        <span
          title="Voiceover / audio track will be mixed into the export"
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--color-accent)",
            border: "1px solid rgba(59,130,246,0.35)",
            borderRadius: 4,
            padding: "1px 6px",
            whiteSpace: "nowrap",
            flexShrink: 0,
            letterSpacing: "0.02em",
          }}
        >
          🎙 Audio
        </span>
      )}

      {/* Export status panel */}
      <ExportStatusPanel
        state={exportState}
        jobStatus={exportJobStatus}
        error={exportError}
        exportMode={exportMode}
        startedAt={startedAt}
        onExport={onExport}
        onPreview={onPreview}
        onReset={onExportReset}
        projectDurationMs={projectDurationMs}
      />

      {/* Save confirmation indicator — fades in on saved, fades out on idle */}
      <span
        aria-live="polite"
        style={{
          fontSize: 11,
          color: "var(--color-success, #22c55e)",
          opacity: saveState === "saved" ? 1 : 0,
          transition: saveState === "saved" ? "opacity 80ms" : "opacity 600ms",
          flexShrink: 0,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        ✓ Saved
      </span>

      {/* Save button */}
      <button
        type="button"
        onClick={onSave}
        disabled={saveState === "saving" || (!isDirty && saveState === "idle")}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 14px",
          borderRadius: 6,
          border: `1px solid ${saveState === "error" ? "var(--color-error)" : saveState === "saved" ? "var(--color-success)" : "var(--color-accent)"}`,
          backgroundColor: "transparent",
          color: saveState === "error"
            ? "var(--color-error)"
            : saveState === "saved"
            ? "var(--color-success)"
            : saveState === "saving" || (!isDirty && saveState === "idle")
            ? "var(--color-text-muted)"
            : "var(--color-accent)",
          cursor: saveState === "saving" || (!isDirty && saveState === "idle") ? "default" : "pointer",
          flexShrink: 0,
          borderColor: saveState === "error"
            ? "var(--color-error)"
            : saveState === "saved"
            ? "var(--color-success)"
            : !isDirty && saveState === "idle"
            ? "var(--color-border)"
            : "var(--color-accent)",
          transition: "color 150ms, border-color 150ms",
        }}
      >
        {SAVE_LABEL[saveState]}
      </button>
    </div>
  );
}
