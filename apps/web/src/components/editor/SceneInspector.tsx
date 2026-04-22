"use client";

import { useState, useEffect, useRef } from "react";
import type { Scene, TextOverlay } from "@/lib/editorProjectTypes";
import { MIN_SCENE_DURATION_S, clampDurationS, effectiveFadeDurationMs, authoredFadeIsClipped } from "@/lib/sceneTiming";

interface SceneInspectorProps {
  scene: Scene;
  /** True when there is a scene after this one (affects fade cap hint). */
  hasNextScene: boolean;
  onDurationChange: (duration: number) => void;
  /**
   * Called when the user clicks "Auto" to restore the video clip's natural duration.
   * Only provided for video scenes where naturalDuration is known.
   */
  onAutoDuration?: () => void;
  onTransitionChange: (transition: "cut" | "fade") => void;
  onFadeDurationChange: (ms: number) => void;
  onOverlayChange: (overlay: TextOverlay | null) => void;
  /**
   * Called when the user adjusts trim handles. Only provided for video scenes
   * where naturalDuration is known.
   */
  onTrimChange?: (trimStart: number, duration: number) => void;
}

const POSITIONS: TextOverlay["position"][] = ["top", "center", "bottom"];
const STYLES: TextOverlay["style"][] = ["subtitle", "title", "minimal"];

const FADE_DEFAULT_MS = 800;

export function SceneInspector({ scene, hasNextScene, onDurationChange, onAutoDuration, onTransitionChange, onFadeDurationChange, onOverlayChange, onTrimChange }: SceneInspectorProps) {
  const overlay = scene.textOverlay ?? null;

  // Local drafts — synced to scene prop changes (scene selection)
  const [durationInput, setDurationInput] = useState(String(scene.duration));
  const [fadeDurationInput, setFadeDurationInput] = useState(String(scene.fadeDurationMs ?? FADE_DEFAULT_MS));
  const [text, setText] = useState(overlay?.text ?? "");
  const [position, setPosition] = useState<TextOverlay["position"]>(overlay?.position ?? "bottom");
  const [style, setStyle] = useState<TextOverlay["style"]>(overlay?.style ?? "subtitle");

  useEffect(() => {
    setDurationInput(String(scene.duration));
    setFadeDurationInput(String(scene.fadeDurationMs ?? FADE_DEFAULT_MS));
    setText(overlay?.text ?? "");
    setPosition(overlay?.position ?? "bottom");
    setStyle(overlay?.style ?? "subtitle");
  }, [scene.id]); // reset when switching scenes

  function commitFadeDuration() {
    const val = parseInt(fadeDurationInput, 10);
    if (!isNaN(val) && val >= 100) {
      const clamped = Math.min(val, 10000);
      onFadeDurationChange(clamped);
      setFadeDurationInput(String(clamped));
    } else {
      setFadeDurationInput(String(scene.fadeDurationMs ?? FADE_DEFAULT_MS));
    }
  }

  function commitDuration() {
    const val = parseFloat(durationInput);
    if (!isNaN(val) && val > 0) {
      const clamped = clampDurationS(val);
      onDurationChange(clamped);
      setDurationInput(String(clamped));
    } else {
      setDurationInput(String(scene.duration));
    }
  }

  function commit(
    nextText: string,
    nextPosition: TextOverlay["position"],
    nextStyle: TextOverlay["style"],
  ) {
    if (!nextText.trim()) {
      onOverlayChange(null);
    } else {
      onOverlayChange({ text: nextText, position: nextPosition, style: nextStyle });
    }
  }

  function handleTextBlur() {
    commit(text, position, style);
  }

  function handlePosition(p: TextOverlay["position"]) {
    setPosition(p);
    if (overlay) commit(text, p, style);
  }

  function handleStyle(s: TextOverlay["style"]) {
    setStyle(s);
    if (overlay) commit(text, position, s);
  }

  function handleClear() {
    setText("");
    onOverlayChange(null);
  }

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderLeft: "1px solid var(--color-border)",
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
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
          }}
        >
          Scene
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {/* Duration */}
        <div style={{ marginBottom: 4 }}>
          <span style={labelStyle}>Duration (s)</span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="number"
              min={String(MIN_SCENE_DURATION_S)}
              step="0.1"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              onBlur={commitDuration}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.currentTarget.blur(); }
                if (e.key === "Escape") { setDurationInput(String(scene.duration)); e.currentTarget.blur(); }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                padding: "5px 8px",
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 5,
                color: "var(--color-text-primary)",
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
              onBlurCapture={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
            {/* "Auto" button — sets duration to detected clip length */}
            {scene.type === "video" && scene.naturalDuration !== undefined && onAutoDuration && (
              <button
                type="button"
                onClick={() => {
                  onAutoDuration();
                  setDurationInput(String(scene.naturalDuration));
                }}
                title={`Set to clip length (${scene.naturalDuration}s)`}
                aria-label={`Auto: set duration to clip length ${scene.naturalDuration}s`}
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "4px 7px",
                  borderRadius: 5,
                  border: "1px solid var(--color-border)",
                  background: "none",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.02em",
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
                Auto
              </button>
            )}
          </div>
        </div>

        {/* Video duration hint — playback window vs natural clip length */}
        {scene.type === "video" && !scene.naturalDuration && (
          <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "3px 0 12px", lineHeight: 1.5 }}>
            Playback window · auto-set from clip once loaded
          </p>
        )}

        {/* Trim section — video scenes with known naturalDuration */}
        {scene.type === "video" && scene.naturalDuration !== undefined && onTrimChange && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={labelStyle}>Trim</span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                <strong style={{ color: "var(--color-text-secondary)" }}>{scene.duration.toFixed(1)}s</strong>
                {" / "}
                {scene.naturalDuration}s
              </span>
            </div>
            <InspectorTrimBar
              trimStart={scene.trimStart ?? 0}
              duration={scene.duration}
              naturalDuration={scene.naturalDuration}
              onTrimChange={(start, dur) => {
                onTrimChange(start, dur);
                setDurationInput(String(dur));
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
              <span>{(scene.trimStart ?? 0).toFixed(1)}s</span>
              <button
                type="button"
                onClick={() => {
                  onTrimChange(0, scene.naturalDuration!);
                  setDurationInput(String(scene.naturalDuration));
                }}
                title="Reset trim to full clip"
                style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, border: "1px solid var(--color-border)", background: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.color = "var(--color-text-muted)"; }}
              >
                Reset
              </button>
              <span>{((scene.trimStart ?? 0) + scene.duration).toFixed(1)}s</span>
            </div>
          </div>
        )}

        {/* Transition */}
        <div style={{ marginBottom: scene.transition === "fade" ? 8 : 12 }}>
          <span style={labelStyle}>Transition</span>
          <div style={{ display: "flex", gap: 4 }}>
            <ToggleButton
              active={(scene.transition ?? "cut") === "cut"}
              onClick={() => onTransitionChange("cut")}
            >
              cut
            </ToggleButton>
            <ToggleButton
              active={scene.transition === "fade"}
              onClick={() => onTransitionChange("fade")}
            >
              fade
            </ToggleButton>
          </div>
        </div>

        {/* Fade duration — visible only when transition is fade */}
        {scene.transition === "fade" && (
          <div style={{ marginBottom: 12 }}>
            <span style={labelStyle}>Fade (ms)</span>
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={fadeDurationInput}
              onChange={(e) => setFadeDurationInput(e.target.value)}
              onBlur={commitFadeDuration}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.currentTarget.blur(); }
                if (e.key === "Escape") {
                  setFadeDurationInput(String(scene.fadeDurationMs ?? FADE_DEFAULT_MS));
                  e.currentTarget.blur();
                }
              }}
              style={{
                display: "block",
                width: "100%",
                fontSize: 12,
                padding: "5px 8px",
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 5,
                color: "var(--color-text-primary)",
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
              onBlurCapture={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
            {/* Cap hint: show effective fade when authored value is larger than the 80 % cap */}
            {authoredFadeIsClipped(scene, hasNextScene) && (
              <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "3px 0 0", lineHeight: 1.5 }}>
                Effective:{" "}
                <strong style={{ color: "var(--color-text-secondary)" }}>
                  {effectiveFadeDurationMs(scene, hasNextScene)}ms
                </strong>{" "}
                (capped at 80 % of scene)
              </p>
            )}
          </div>
        )}

        <div
          style={{
            borderTop: "1px solid var(--color-border)",
            marginBottom: 12,
            marginLeft: -12,
            marginRight: -12,
            paddingTop: 10,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <span style={labelStyle}>Text Overlay</span>
        </div>

        {/* Text input */}
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={labelStyle}>Text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleTextBlur}
            placeholder="Add overlay text…"
            rows={3}
            style={{
              display: "block",
              width: "100%",
              resize: "vertical",
              fontSize: 12,
              padding: "6px 8px",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border)",
              borderRadius: 5,
              color: "var(--color-text-primary)",
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              lineHeight: 1.5,
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
            onBlurCapture={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
          />
        </label>

        {/* Position */}
        <div style={{ marginBottom: 10 }}>
          <span style={labelStyle}>Position</span>
          <div style={{ display: "flex", gap: 4 }}>
            {POSITIONS.map((p) => (
              <ToggleButton
                key={p}
                active={position === p}
                onClick={() => handlePosition(p)}
              >
                {p}
              </ToggleButton>
            ))}
          </div>
        </div>

        {/* Style */}
        <div style={{ marginBottom: 12 }}>
          <span style={labelStyle}>Style</span>
          <div style={{ display: "flex", gap: 4 }}>
            {STYLES.map((s) => (
              <ToggleButton
                key={s}
                active={style === s}
                onClick={() => handleStyle(s)}
              >
                {s}
              </ToggleButton>
            ))}
          </div>
        </div>

        {/* Hint when auto-captions added a slot but no text has been entered yet */}
        {overlay && !overlay.text && (
          <p style={{ fontSize: 11, color: "var(--color-accent)", margin: "0 0 8px", lineHeight: 1.5, opacity: 0.8 }}>
            Caption slot ready — type above to apply.
          </p>
        )}

        {/* Clear */}
        {overlay && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: 5,
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--color-error, #ef4444)";
              e.currentTarget.style.color = "var(--color-error, #ef4444)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--color-border)";
              e.currentTarget.style.color = "var(--color-text-muted)";
            }}
          >
            Clear overlay
          </button>
        )}

        {/* Empty hint */}
        {!overlay && (
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
            Type text above and click outside to apply.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Inspector trim bar ────────────────────────────────────────────────────────

function InspectorTrimBar({
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
      aria-label={`Trim: ${trimStart.toFixed(1)}s – ${(trimStart + duration).toFixed(1)}s of ${naturalDuration}s`}
      style={{
        position: "relative",
        height: 12,
        backgroundColor: "var(--color-border)",
        borderRadius: 3,
        overflow: "visible",
        cursor: "default",
      }}
    >
      {/* Untrimmed (ghosted) tails */}
      <div style={{ position: "absolute", inset: 0, borderRadius: 3, backgroundColor: "var(--color-bg-primary)", opacity: 0.4, pointerEvents: "none" }} />
      {/* Active trim region */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${startFrac * 100}%`,
          width: `${(endFrac - startFrac) * 100}%`,
          backgroundColor: "var(--color-accent)",
          opacity: 0.4,
          pointerEvents: "none",
          borderRadius: 2,
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
          top: 0,
          bottom: 0,
          left: `${startFrac * 100}%`,
          width: 10,
          transform: "translateX(-50%)",
          backgroundColor: "var(--color-accent)",
          cursor: "ew-resize",
          borderRadius: "3px 0 0 3px",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 1.5, height: 6, backgroundColor: "rgba(255,255,255,0.7)", borderRadius: 1, pointerEvents: "none" }} />
      </div>
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
          top: 0,
          bottom: 0,
          left: `${endFrac * 100}%`,
          width: 10,
          transform: "translateX(-50%)",
          backgroundColor: "var(--color-accent)",
          cursor: "ew-resize",
          borderRadius: "0 3px 3px 0",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 1.5, height: 6, backgroundColor: "rgba(255,255,255,0.7)", borderRadius: 1, pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-muted)",
  marginBottom: 4,
};

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 10,
        padding: "4px 0",
        borderRadius: 4,
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        background: active ? "rgba(59,130,246,0.1)" : "none",
        color: active ? "var(--color-accent)" : "var(--color-text-muted)",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        textTransform: "capitalize",
      }}
    >
      {children}
    </button>
  );
}
