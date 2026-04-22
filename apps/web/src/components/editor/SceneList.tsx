"use client";

import { useState, useRef } from "react";
import type { Scene } from "@/lib/editorProjectTypes";
import { clampDurationS, MIN_SCENE_DURATION_S } from "@/lib/sceneTiming";

interface SceneListProps {
  scenes: Scene[];
  /** Single active-scene authority: follows playIndex while playing, selectedId while paused. */
  activeId: string | null;
  onSelect: (id: string) => void;
  onMove: (idx: number, dir: "up" | "down") => void;
  onRemove: (idx: number) => void;
  onDurationChange: (idx: number, duration: number) => void;
  onTrimChange: (idx: number, trimStart: number, duration: number) => void;
  onAddScene: () => void;
  onReorder: (scenes: Scene[]) => void;
  onVideoDurationDetected?: (idx: number, naturalSecs: number) => void;
}

function artifactUrl(path: string): string {
  return `/api/artifacts?path=${encodeURIComponent(path)}`;
}

export function SceneList({
  scenes,
  activeId,
  onSelect,
  onMove,
  onRemove,
  onDurationChange,
  onTrimChange,
  onAddScene,
  onReorder,
  onVideoDurationDetected,
}: SceneListProps) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  function handleDrop(targetIdx: number) {
    if (draggingIdx === null || draggingIdx === targetIdx) {
      setDraggingIdx(null);
      setHoverIdx(null);
      return;
    }
    const next = [...scenes];
    const [moved] = next.splice(draggingIdx, 1);
    next.splice(targetIdx, 0, moved!);
    onReorder(next);
    setDraggingIdx(null);
    setHoverIdx(null);
  }

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)" }}>
          Scenes
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {scenes.length} scene{scenes.length !== 1 ? "s" : ""} · {formatDuration(scenes.reduce((sum, s) => sum + s.duration, 0))}
        </span>
      </div>

      {/* Scene cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {scenes.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", padding: "12px 4px", textAlign: "center" }}>
            No scenes yet.
          </p>
        ) : (
          scenes.map((scene, idx) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              idx={idx}
              total={scenes.length}
              isActive={scene.id === activeId}
              isDragging={idx === draggingIdx}
              isDropTarget={idx === hoverIdx && idx !== draggingIdx}
              onSelect={() => onSelect(scene.id)}
              onMoveUp={() => onMove(idx, "up")}
              onMoveDown={() => onMove(idx, "down")}
              onRemove={() => onRemove(idx)}
              onDurationChange={(d) => onDurationChange(idx, d)}
              onTrimChange={(trimStart, dur) => onTrimChange(idx, trimStart, dur)}
              onVideoDurationDetected={onVideoDurationDetected ? (n) => onVideoDurationDetected(idx, n) : undefined}
              onDragStart={() => setDraggingIdx(idx)}
              onDragEnter={() => setHoverIdx(idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDraggingIdx(null); setHoverIdx(null); }}
            />
          ))
        )}
      </div>

      {/* Add scene placeholder */}
      <div
        style={{
          padding: "8px",
          borderTop: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onAddScene}
          title="Add scene from workflow artifacts"
          style={{
            width: "100%",
            padding: "7px",
            fontSize: 12,
            color: "var(--color-text-secondary)",
            background: "none",
            border: "1px dashed var(--color-border)",
            borderRadius: 6,
            cursor: "pointer",
            textAlign: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-accent)";
            e.currentTarget.style.color = "var(--color-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.color = "var(--color-text-secondary)";
          }}
        >
          + Add Scene
        </button>
      </div>
    </div>
  );
}

// ── Scene card ──────────────────────────────────────────────────────────────

interface SceneCardProps {
  scene: Scene;
  idx: number;
  total: number;
  isActive: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDurationChange: (duration: number) => void;
  onTrimChange: (trimStart: number, duration: number) => void;
  onVideoDurationDetected?: (naturalSecs: number) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function SceneCard({
  scene,
  idx,
  total,
  isActive,
  isDragging,
  isDropTarget,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDurationChange,
  onTrimChange,
  onVideoDurationDetected,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: SceneCardProps) {
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationInput, setDurationInput] = useState(String(scene.duration));

  function commitDuration() {
    const val = parseFloat(durationInput);
    if (!isNaN(val) && val > 0) {
      onDurationChange(clampDurationS(val));
    } else {
      setDurationInput(String(scene.duration));
    }
    setEditingDuration(false);
  }

  const src = scene.trimStart && scene.trimStart > 0
    ? `${artifactUrl(scene.src)}#t=${scene.trimStart}`
    : artifactUrl(scene.src);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }}}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragEnter(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      style={{
        borderRadius: 6,
        border: `1px solid ${isActive || isDropTarget ? "var(--color-accent)" : "var(--color-border)"}`,
        backgroundColor: isActive ? "rgba(59,130,246,0.06)" : "var(--color-surface)",
        cursor: "grab",
        overflow: "hidden",
        userSelect: "none",
        opacity: isDragging ? 0.5 : 1,
        transition: "opacity 120ms, border-color 80ms, box-shadow 80ms",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: "relative",
          height: 52,
          backgroundColor: "var(--color-bg-primary)",
          overflow: "hidden",
        }}
      >
        {scene.type === "video" ? (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            draggable={false}
            onLoadedMetadata={(e) => {
              if (scene.naturalDuration === undefined && e.currentTarget.duration > 0) {
                onVideoDurationDetected?.(e.currentTarget.duration);
              }
            }}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`Scene ${idx + 1}`}
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
          />
        )}

        {/* Type badge */}
        <span
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "1px 5px",
            borderRadius: 3,
            backgroundColor: scene.type === "video" ? "rgba(249,115,22,0.85)" : "rgba(168,85,247,0.85)",
            color: "#fff",
          }}
        >
          {scene.type}
        </span>

        {/* Scene index */}
        <span
          style={{
            position: "absolute",
            bottom: 3,
            right: 4,
            fontSize: 9,
            color: "rgba(255,255,255,0.6)",
            fontWeight: 600,
          }}
        >
          {idx + 1}
        </span>

        {/* Fade transition indicator */}
        {scene.transition === "fade" && (
          <span
            style={{
              position: "absolute",
              bottom: 3,
              left: 4,
              fontSize: 8,
              fontWeight: 700,
              lineHeight: 1,
              padding: "2px 4px",
              borderRadius: 3,
              backgroundColor: "rgba(0,0,0,0.55)",
              color: "rgba(255,255,255,0.7)",
              letterSpacing: "0.02em",
              pointerEvents: "none",
            }}
          >
            Fade
          </span>
        )}

        {/* Overlay indicator */}
        {scene.textOverlay?.text && (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              fontSize: 8,
              fontWeight: 700,
              lineHeight: 1,
              padding: "2px 4px",
              borderRadius: 3,
              backgroundColor: "rgba(0,0,0,0.55)",
              color: "rgba(255,255,255,0.7)",
              letterSpacing: "0.02em",
              pointerEvents: "none",
            }}
          >
            T
          </span>
        )}
      </div>

      {/* Trim bar — video scenes only, once natural duration is known */}
      {scene.type === "video" && scene.naturalDuration !== undefined && (
        <TrimBar
          trimStart={scene.trimStart ?? 0}
          duration={scene.duration}
          naturalDuration={scene.naturalDuration}
          onTrimChange={onTrimChange}
        />
      )}

      {/* Controls row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 6px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Duration */}
        {editingDuration ? (
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => { if (e.key === "Enter") commitDuration(); if (e.key === "Escape") { setDurationInput(String(scene.duration)); setEditingDuration(false); } }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            style={{
              width: 44,
              fontSize: 11,
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-accent)",
              borderRadius: 3,
              color: "var(--color-text-primary)",
              padding: "1px 4px",
              outline: "none",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setDurationInput(String(scene.duration)); setEditingDuration(true); }}
            title="Click to edit duration (seconds)"
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              background: "none",
              border: "none",
              padding: "1px 2px",
              cursor: "pointer",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            {scene.duration}s
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Move up */}
        <IconButton
          onClick={onMoveUp}
          disabled={idx === 0}
          title="Move scene up"
          aria-label="Move scene up"
        >
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 6.5l3-3 3 3" />
          </svg>
        </IconButton>

        {/* Move down */}
        <IconButton
          onClick={onMoveDown}
          disabled={idx === total - 1}
          title="Move scene down"
          aria-label="Move scene down"
        >
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3.5l3 3 3-3" />
          </svg>
        </IconButton>

        {/* Remove */}
        <IconButton
          onClick={onRemove}
          title="Remove scene"
          aria-label="Remove scene"
          danger
        >
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M2 2l6 6M8 2L2 8" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

// ── Trim bar ─────────────────────────────────────────────────────────────────

function TrimBar({
  trimStart,
  duration,
  naturalDuration,
  onTrimChange,
}: {
  trimStart: number;
  duration: number;
  naturalDuration: number;
  onTrimChange: (trimStart: number, duration: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const startFrac = trimStart / naturalDuration;
  const endFrac = Math.min((trimStart + duration) / naturalDuration, 1);

  function makeDragHandler(handle: "left" | "right") {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      function onMove(ev: PointerEvent) {
        const bar = barRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const frac = Math.max(0, Math.min((ev.clientX - rect.left) / rect.width, 1));
        const sec = frac * naturalDuration;
        if (handle === "left") {
          const trimEnd = trimStart + duration;
          const newStart = Math.max(0, Math.min(sec, trimEnd - MIN_SCENE_DURATION_S));
          const rounded = Math.round(newStart * 10) / 10;
          onTrimChange(rounded, clampDurationS(trimEnd - rounded));
        } else {
          const newEnd = Math.min(naturalDuration, Math.max(sec, trimStart + MIN_SCENE_DURATION_S));
          const rounded = Math.round(newEnd * 10) / 10;
          onTrimChange(trimStart, clampDurationS(rounded - trimStart));
        }
      }

      function onUp() {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
      }

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    };
  }

  return (
    <div
      ref={barRef}
      draggable={false}
      aria-label={`Trim: ${trimStart.toFixed(1)}s – ${(trimStart + duration).toFixed(1)}s`}
      style={{
        position: "relative",
        height: 6,
        backgroundColor: "var(--color-border)",
        flexShrink: 0,
        overflow: "visible",
      }}
    >
      {/* Selected trim region */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${startFrac * 100}%`,
          width: `${(endFrac - startFrac) * 100}%`,
          backgroundColor: "var(--color-accent)",
          opacity: 0.45,
          pointerEvents: "none",
        }}
      />
      {/* Left handle */}
      <div
        role="slider"
        aria-label="Trim start"
        aria-valuemin={0}
        aria-valuemax={naturalDuration}
        aria-valuenow={trimStart}
        onPointerDown={makeDragHandler("left")}
        style={{
          position: "absolute",
          top: -1,
          bottom: -1,
          left: `${startFrac * 100}%`,
          width: 7,
          transform: "translateX(-50%)",
          backgroundColor: "var(--color-accent)",
          cursor: "ew-resize",
          borderRadius: "2px 0 0 2px",
          zIndex: 2,
        }}
      />
      {/* Right handle */}
      <div
        role="slider"
        aria-label="Trim end"
        aria-valuemin={0}
        aria-valuemax={naturalDuration}
        aria-valuenow={trimStart + duration}
        onPointerDown={makeDragHandler("right")}
        style={{
          position: "absolute",
          top: -1,
          bottom: -1,
          left: `${endFrac * 100}%`,
          width: 7,
          transform: "translateX(-50%)",
          backgroundColor: "var(--color-accent)",
          cursor: "ew-resize",
          borderRadius: "0 2px 2px 0",
          zIndex: 2,
        }}
      />
    </div>
  );
}

// ── Icon button ──────────────────────────────────────────────────────────────

function IconButton({
  onClick,
  disabled,
  title,
  "aria-label": ariaLabel,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        padding: 0,
        background: "none",
        border: "none",
        borderRadius: 3,
        cursor: disabled ? "default" : "pointer",
        color: disabled
          ? "var(--color-border)"
          : danger
          ? "var(--color-text-muted)"
          : "var(--color-text-muted)",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.color = danger ? "var(--color-error)" : "var(--color-text-secondary)";
          e.currentTarget.style.backgroundColor = "var(--color-surface-hover)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = disabled ? "var(--color-border)" : "var(--color-text-muted)";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0s";
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded}s`;
}
