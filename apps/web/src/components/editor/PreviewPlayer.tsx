"use client";

import { useState, useEffect, useRef } from "react";
import type { AspectRatio, AudioTrack, Scene, TextOverlay } from "@/lib/editorProjectTypes";
import { computeFadeProgress } from "@/lib/sceneTiming";
import type { RenderPlan } from "@/lib/renderPlan";

interface PreviewPlayerProps {
  scene: Scene | null;
  scenes: Scene[];
  plan: RenderPlan;
  playIndex: number;
  playEpoch: number;
  seekOffsetMs: number;
  isScrubbing: boolean;
  aspectRatio: AspectRatio;
  isPlaying: boolean;
  canPlay: boolean;
  onPlayPause: () => void;
  onSeek: (targetMs: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  /** Current audio track, or null/undefined if none. */
  audioTrack?: AudioTrack | null;
  /** Called when the user changes the audio track (volume, remove). */
  onAudioChange?: (track: AudioTrack | null) => void;
  /** Called when the user clicks "+ Add Audio" — opens the artifact picker. */
  onAudioLoad?: () => void;
  /** Whether auto-captions mode is enabled (bulk subtitle overlays). */
  autoCaptionsEnabled?: boolean;
  /** Toggles auto-captions mode in the parent shell. */
  onToggleAutoCaptions?: () => void;
  /** Called when the user clicks "Generate Voiceover" — POSTs to the voiceover endpoint. */
  onGenerateVoiceover?: () => void;
  /** True while a voiceover generation request is in flight. */
  voiceoverLoading?: boolean;
  /** Non-null when the last voiceover generation attempt failed. */
  voiceoverError?: string | null;
  /** True for ~3 s after a successful voiceover generation — drives the "✓ Generated" badge. */
  voiceoverSuccess?: boolean;
}

// CSS padding-bottom trick: height = 0, padding-bottom = ratio %
const ASPECT_PADDING: Record<AspectRatio, string> = {
  "16:9": "56.25%",
  "9:16": "177.78%",
  "1:1":  "100%",
};

function artifactUrl(path: string): string {
  return `/api/artifacts?path=${encodeURIComponent(path)}`;
}


const MEDIA_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
};

function renderSceneLayer(s: Scene, showCaptions: boolean) {
  // Append #t=<start> media fragment so the browser seeks to the trim start on load.
  const videoSrc = s.trimStart && s.trimStart > 0
    ? `${artifactUrl(s.src)}#t=${s.trimStart}`
    : artifactUrl(s.src);
  return (
    <>
      {s.type === "video" ? (
        <video
          key={`${s.src}|t${s.trimStart ?? 0}`}
          src={videoSrc}
          muted
          playsInline
          style={MEDIA_STYLE}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={s.src}
          src={artifactUrl(s.src)}
          alt="Scene preview"
          style={MEDIA_STYLE}
        />
      )}
      {s.textOverlay?.text && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            ...(s.textOverlay.position === "top"
              ? { top: "8%" }
              : s.textOverlay.position === "bottom"
              ? { bottom: "8%" }
              : { top: "50%", transform: "translateY(-50%)" }),
            display: "flex",
            justifyContent: "center",
            padding: "0 8%",
            pointerEvents: "none",
            // Fade in/out when CC is toggled rather than mount/unmount abruptly
            opacity: showCaptions ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
        >
          <span style={overlayTextStyle(s.textOverlay.style)}>{s.textOverlay.text}</span>
        </div>
      )}
    </>
  );
}

function overlayTextStyle(style: TextOverlay["style"]): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    maxWidth: "100%",
    wordBreak: "break-word",
    textAlign: "center",
    lineHeight: 1.4,
  };
  if (style === "title") {
    return {
      ...base,
      fontSize: "clamp(16px, 4%, 28px)",
      fontWeight: 700,
      color: "#fff",
      textShadow: "0 2px 8px rgba(0,0,0,0.8)",
      letterSpacing: "0.01em",
    };
  }
  if (style === "minimal") {
    return {
      ...base,
      fontSize: "clamp(10px, 2.5%, 16px)",
      fontWeight: 400,
      color: "rgba(255,255,255,0.85)",
      textShadow: "0 1px 4px rgba(0,0,0,0.6)",
    };
  }
  // subtitle (default)
  return {
    ...base,
    fontSize: "clamp(12px, 3%, 20px)",
    fontWeight: 600,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: "4px 12px",
    borderRadius: 4,
  };
}

export function PreviewPlayer({ scene, scenes, plan, playIndex, playEpoch, seekOffsetMs, isScrubbing, aspectRatio, isPlaying, canPlay, onPlayPause, onSeek, onScrubStart, onScrubEnd, isLooping, onToggleLoop, audioTrack, onAudioChange, onAudioLoad, autoCaptionsEnabled, onToggleAutoCaptions, onGenerateVoiceover, voiceoverLoading, voiceoverError, voiceoverSuccess }: PreviewPlayerProps) {
  // ── Progress tracking ────────────────────────────────────────────────────
  const [sceneElapsedMs, setSceneElapsedMs] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  // Keep a ref so the playEpoch effect always reads the latest seekOffsetMs
  const seekOffsetMsRef = useRef(seekOffsetMs);
  seekOffsetMsRef.current = seekOffsetMs;
  // Local ref tracks whether a pointer drag is in progress (avoids relying on React state for event gating)
  const isDraggingRef = useRef(false);

  // ── Audio refs & state ──────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  // Keep a stable ref to priorMs so audio-sync effects always see the latest value
  const priorMsRef = useRef(0);

  // Reset scene-elapsed clock when a new scene epoch starts (play, advance, loop, seek)
  useEffect(() => {
    setSceneElapsedMs(seekOffsetMsRef.current);
    lastTickRef.current = null;
  }, [playEpoch]);

  // RAF loop — runs only while playing and not scrubbing; local to PreviewPlayer only
  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      lastTickRef.current = null;
      return;
    }
    function tick(now: number) {
      if (lastTickRef.current !== null) {
        const delta = now - lastTickRef.current;
        setSceneElapsedMs((prev) => prev + delta);
      }
      lastTickRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [isPlaying, isScrubbing]);

  // Derived progress values — resolved from pre-computed plan entries (O(1) lookups)
  const activePlanEntry = plan.scenes[playIndex];
  const priorMs = activePlanEntry?.startMs ?? 0;
  priorMsRef.current = priorMs;
  const currentSceneDurationMs = activePlanEntry?.durationMs ?? 0;
  const elapsedMs = priorMs + Math.min(sceneElapsedMs, currentSceneDurationMs);
  const totalMs = plan.totalDurationMs;
  const progress = totalMs > 0 ? Math.min(elapsedMs / totalMs, 1) : 0;

  // Active-scene segment bounds as percentages
  const activeStartPct = totalMs > 0 ? (priorMs / totalMs) * 100 : 0;
  const activeEndPct   = totalMs > 0 ? (Math.min(priorMs + currentSceneDurationMs, totalMs) / totalMs) * 100 : 0;

  // Scene-boundary tick positions as percentages (skip 0 % — that's the bar start)
  const tickPcts: number[] = [];
  if (totalMs > 0 && plan.scenes.length > 1) {
    for (let i = 0; i < plan.scenes.length - 1; i++) {
      tickPcts.push((plan.scenes[i]!.endMs / totalMs) * 100);
    }
  }

  // Fade-transition progress (0 = no fade / cut; 1 = fully on next scene)
  const nextScene = scenes[playIndex + 1] ?? null;
  const currentScene = scenes[playIndex] ?? null;
  const rawFadeProgress = currentScene
    ? computeFadeProgress(currentScene, nextScene !== null, sceneElapsedMs)
    : 0;
  // Apply smooth-step easing (t² × (3 − 2t)) so the dissolve accelerates out of
  // full-opacity and decelerates into the incoming scene, giving a more cinematic feel.
  const fadeProgress = rawFadeProgress * rawFadeProgress * (3 - 2 * rawFadeProgress);

  // ── Audio sync effects ───────────────────────────────────────────────────

  // Seek audio whenever the play epoch changes (play start, scene advance, scrub seek)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioTrack) return;
    audio.currentTime = (priorMsRef.current + seekOffsetMsRef.current) / 1000;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playEpoch, audioTrack]);

  // Play or pause audio in lockstep with the video player
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioTrack) return;
    if (isPlaying && !isScrubbing) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [isPlaying, isScrubbing, audioTrack]);

  // Sync volume / mute
  const audioVolume = audioTrack?.volume ?? 1;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = audioMuted ? 0 : audioVolume;
  }, [audioVolume, audioMuted]);

  // ── Scrub helper ─────────────────────────────────────────────────────────
  function seekFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (!canPlay || totalMs === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    onSeek(fraction * totalMs);
  }
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "var(--color-bg-primary)",
      }}
    >
      {/* Preview area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          overflow: "auto",
        }}
      >
      {scene ? (
        <div
          style={{
            width: "100%",
            maxWidth: aspectRatio === "9:16" ? 360 : 720,
          }}
        >
          {/* Aspect-ratio container */}
          <div
            style={{
              position: "relative",
              width: "100%",
              paddingBottom: ASPECT_PADDING[aspectRatio],
              backgroundColor: "#000",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--color-border)",
            }}
          >
            {/* Outgoing (current) scene — fades out when transition === "fade" */}
            <div style={{ position: "absolute", inset: 0, opacity: 1 - fadeProgress }}>
              {renderSceneLayer(scene, !!autoCaptionsEnabled)}
            </div>
            {/* Incoming (next) scene — rendered only during a fade */}
            {fadeProgress > 0 && nextScene && (
              <div style={{ position: "absolute", inset: 0, opacity: fadeProgress }}>
                {renderSceneLayer(nextScene, !!autoCaptionsEnabled)}
              </div>
            )}
          </div>

          {/* Scene info beneath preview */}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              color: "var(--color-text-muted)",
            }}
          >
            <span
              style={{
                padding: "1px 7px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                backgroundColor: scene.type === "video"
                  ? "rgba(249,115,22,0.12)"
                  : "rgba(168,85,247,0.12)",
                color: scene.type === "video" ? "#f97316" : "#a855f7",
                border: `1px solid ${scene.type === "video" ? "rgba(249,115,22,0.25)" : "rgba(168,85,247,0.25)"}`,
              }}
            >
              {scene.type}
            </span>
            <span>{scene.duration}s</span>
            {scene.transition && (
              <span style={{ color: "var(--color-text-muted)" }}>
                → {scene.transition}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg
            width={40}
            height={40}
            viewBox="0 0 40 40"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="8" width="30" height="24" rx="3" />
            <path d="M16 16l8 4-8 4V16z" />
          </svg>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
            Select a scene to preview
          </p>
        </div>
      )}
      </div>

      {/* Hidden audio element — synced to video playback */}
      {audioTrack && (
        <audio
          key={audioTrack.src}
          ref={audioRef}
          src={artifactUrl(audioTrack.src)}
          preload="auto"
          style={{ display: "none" }}
        />
      )}

      {/* Playback controls */}
      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          flexShrink: 0,
        }}
      >
        {/* Progress bar — 12 px hit area, 3 px visual track, drag-to-scrub */}
        <div
          aria-label="Seek"
          onPointerDown={(e) => {
            if (!canPlay || totalMs === 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            isDraggingRef.current = true;
            onScrubStart();
            seekFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (!isDraggingRef.current) return;
            seekFromPointer(e);
          }}
          onPointerUp={(e) => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            seekFromPointer(e);
            onScrubEnd();
          }}
          onPointerCancel={() => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            onScrubEnd();
          }}
          style={{
            height: 12,
            display: "flex",
            alignItems: "center",
            cursor: canPlay ? "pointer" : "default",
            position: "relative",
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 3,
              backgroundColor: "var(--color-border)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                backgroundColor: "var(--color-accent)",
              }}
            />
            {activeEndPct > activeStartPct && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${activeStartPct}%`,
                  width: `${activeEndPct - activeStartPct}%`,
                  backgroundColor: "var(--color-accent)",
                  opacity: 0.25,
                  pointerEvents: "none",
                }}
              />
            )}
            {tickPcts.map((pct) => (
              <div
                key={pct}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${pct}%`,
                  width: 1,
                  backgroundColor: "var(--color-bg-secondary)",
                  opacity: 0.7,
                }}
              />
            ))}
            {/* Fade-transition zones: purple gradient band at the tail of each fading scene */}
            {totalMs > 0 && plan.scenes.map((entry) => {
              if (entry.fadeDurationMs <= 0) return null;
              const fadeStartPct = (entry.fadeStartMs / totalMs) * 100;
              const fadeWidthPct = (entry.fadeDurationMs / totalMs) * 100;
              return (
                <div
                  key={`fz-${entry.id}`}
                  title={`Crossfade: ${entry.fadeDurationMs}ms`}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${fadeStartPct}%`,
                    width: `${fadeWidthPct}%`,
                    background: "linear-gradient(to right, transparent, rgba(168,85,247,0.5))",
                    pointerEvents: "none",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Button row */}
        <div style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!canPlay}
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause" : "Play"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            backgroundColor: isPlaying ? "var(--color-accent)" : "var(--color-surface)",
            color: isPlaying ? "#fff" : "var(--color-text-secondary)",
            cursor: canPlay ? "pointer" : "default",
            opacity: canPlay ? 1 : 0.4,
            transition: "background-color 120ms, color 120ms",
          }}
        >
          {isPlaying ? (
            <svg width={12} height={12} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <rect x="2" y="1" width="3" height="10" rx="1" />
              <rect x="7" y="1" width="3" height="10" rx="1" />
            </svg>
          ) : (
            <svg width={12} height={12} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M3 1.5l7 4.5-7 4.5V1.5z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleLoop}
          title={isLooping ? "Loop on" : "Loop off"}
          aria-label={isLooping ? "Disable loop" : "Enable loop"}
          aria-pressed={isLooping}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${isLooping ? "var(--color-accent)" : "var(--color-border)"}`,
            backgroundColor: isLooping ? "rgba(59,130,246,0.10)" : "transparent",
            color: isLooping ? "var(--color-accent)" : "var(--color-text-muted)",
            cursor: "pointer",
            transition: "border-color 120ms, color 120ms, background-color 120ms",
          }}
        >
          <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 5A4 4 0 0 1 8.5 2L10 2" />
            <path d="M8 1l2 1-2 1" />
            <path d="M11 7A4 4 0 0 1 3.5 10L2 10" />
            <path d="M4 11l-2-1 2-1" />
          </svg>
        </button>

        {onToggleAutoCaptions && (
          <button
            type="button"
            onClick={onToggleAutoCaptions}
            title={autoCaptionsEnabled
              ? "Hide captions (CC on)"
              : "Show captions — also adds caption slots to scenes without one"}
            aria-label={autoCaptionsEnabled ? "Hide captions" : "Show captions"}
            aria-pressed={!!autoCaptionsEnabled}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: `1px solid ${autoCaptionsEnabled ? "var(--color-accent)" : "var(--color-border)"}`,
              backgroundColor: autoCaptionsEnabled ? "rgba(59,130,246,0.10)" : "transparent",
              color: autoCaptionsEnabled ? "var(--color-accent)" : "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              transition: "border-color 120ms, color 120ms, background-color 120ms",
            }}
          >
            CC
          </button>
        )}

          <div style={{ flex: 1 }} />

          {scenes.length > 0 && (
            <span
              style={{
                fontSize: 10,
                color: "var(--color-text-muted)",
                flexShrink: 0,
              }}
            >
              Scene {playIndex + 1} / {scenes.length}
            </span>
          )}

          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-muted)",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {formatTime(elapsedMs)} / {formatTime(totalMs)}
          </span>
        </div>

        {/* Audio track row */}
        <AudioTrackRow
          audioTrack={audioTrack ?? null}
          progress={progress}
          muted={audioMuted}
          onMuteToggle={() => setAudioMuted((m) => !m)}
          onVolumeChange={(v) => onAudioChange?.({ ...(audioTrack!), volume: v })}
          onRemove={() => { onAudioChange?.(null); setAudioMuted(false); }}
          onLoad={onAudioLoad}
          onGenerateVoiceover={onGenerateVoiceover}
          voiceoverLoading={voiceoverLoading}
          voiceoverError={voiceoverError}
          voiceoverSuccess={voiceoverSuccess}
        />
      </div>
    </div>
  );
}

// ── Audio Track Row ───────────────────────────────────────────────────────────

// Static waveform heights (1–24 px) — visual placeholder for V1.
const WAVEFORM_BARS = [4,7,11,16,9,20,24,18,12,22,19,14,8,13,21,10,6,9,15,11,7,17,23,8,5,10,14,8,4,7,12,18,9,21,16,11,6,8,13,9];

function AudioTrackRow({
  audioTrack,
  progress,
  muted,
  onMuteToggle,
  onVolumeChange,
  onRemove,
  onLoad,
  onGenerateVoiceover,
  voiceoverLoading,
  voiceoverError,
  voiceoverSuccess,
}: {
  audioTrack: AudioTrack | null;
  progress: number;
  muted: boolean;
  onMuteToggle: () => void;
  onVolumeChange: (v: number) => void;
  onRemove: () => void;
  onLoad?: () => void;
  onGenerateVoiceover?: () => void;
  voiceoverLoading?: boolean;
  voiceoverError?: string | null;
  voiceoverSuccess?: boolean;
}) {
  const rowStyle: React.CSSProperties = {
    borderTop: "1px solid var(--color-border)",
    padding: "5px 12px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
  };

  const iconStyle: React.CSSProperties = {
    flexShrink: 0,
    color: "var(--color-text-muted)",
    display: "flex",
    alignItems: "center",
  };

  const btnStyle: React.CSSProperties = {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 5,
    border: "1px solid var(--color-border)",
    backgroundColor: "transparent",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    fontSize: 10,
    padding: 0,
  };

  return (
    <div style={rowStyle}>
      {/* Music note icon */}
      <span style={iconStyle} aria-hidden="true">
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9V3l6-1v6" />
          <circle cx="2.5" cy="9" r="1.5" />
          <circle cx="8.5" cy="8" r="1.5" />
        </svg>
      </span>

      {audioTrack ? (
        <>
          {/* Waveform visualization */}
          <div
            aria-label="Audio track waveform"
            style={{ flex: 1, height: 26, position: "relative", borderRadius: 3, overflow: "hidden", backgroundColor: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}
          >
            {/* All bars (dim — unplayed) */}
            <svg
              viewBox={`0 0 ${WAVEFORM_BARS.length * 4} 26`}
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              aria-hidden="true"
            >
              {WAVEFORM_BARS.map((h, i) => (
                <rect key={i} x={i * 4 + 1} y={(26 - h) / 2} width={3} height={h} rx={1} fill="var(--color-accent)" opacity={0.25} />
              ))}
            </svg>
            {/* Played portion (brighter), clipped to progress */}
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`, pointerEvents: "none" }}>
              <svg
                viewBox={`0 0 ${WAVEFORM_BARS.length * 4} 26`}
                preserveAspectRatio="none"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                aria-hidden="true"
              >
                {WAVEFORM_BARS.map((h, i) => (
                  <rect key={i} x={i * 4 + 1} y={(26 - h) / 2} width={3} height={h} rx={1} fill="var(--color-accent)" opacity={0.75} />
                ))}
              </svg>
            </div>
            {/* Playhead cursor */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${progress * 100}%`, width: 1.5, backgroundColor: "white", opacity: 0.7, pointerEvents: "none" }} />
          </div>

          {/* "✓ Generated" success badge — visible for 3 s after voiceover generation */}
          {voiceoverSuccess && (
            <span
              aria-live="polite"
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-success, #22c55e)",
                opacity: 1,
                transition: "opacity 300ms ease",
                whiteSpace: "nowrap",
              }}
            >
              ✓ Generated
            </span>
          )}

          {/* Mute toggle */}
          <button
            type="button"
            onClick={onMuteToggle}
            title={muted ? "Unmute" : "Mute"}
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            aria-pressed={muted}
            style={{ ...btnStyle, color: muted ? "var(--color-accent)" : "var(--color-text-muted)", borderColor: muted ? "var(--color-accent)" : "var(--color-border)" }}
          >
            {muted ? (
              <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
                <path d="M1 4H4L7 2V10L4 8H1V4Z" />
                <line x1="10" y1="4" x2="12" y2="6" /><line x1="12" y1="4" x2="10" y2="6" />
              </svg>
            ) : (
              <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
                <path d="M1 4H4L7 2V10L4 8H1V4Z" />
                <path d="M9 4.5C9.5 5 10 5.5 10 6S9.5 7 9 7.5" />
              </svg>
            )}
          </button>

          {/* Volume slider */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={audioTrack.volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            aria-label="Audio volume"
            disabled={muted}
            style={{ width: 64, accentColor: "var(--color-accent)", opacity: muted ? 0.4 : 1 }}
          />

          {/* Remove audio */}
          <button
            type="button"
            onClick={onRemove}
            title="Remove audio track"
            aria-label="Remove audio track"
            style={{ ...btnStyle, color: "var(--color-text-muted)" }}
          >
            <svg width={9} height={9} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
              <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={onLoad}
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                background: "none",
                border: "1px dashed var(--color-border)",
                borderRadius: 5,
                padding: "3px 10px",
                cursor: "pointer",
              }}
            >
              + Add Audio
            </button>
            {onGenerateVoiceover && (
              <button
                type="button"
                onClick={onGenerateVoiceover}
                disabled={!!voiceoverLoading}
                title={voiceoverLoading
                  ? "Generating voiceover…"
                  : "Synthesize speech from scene captions using fal.ai Kokoro TTS"}
                aria-label={voiceoverLoading ? "Generating voiceover" : "Generate voiceover from captions"}
                style={{
                  fontSize: 11,
                  color: voiceoverLoading ? "var(--color-text-muted)" : "var(--color-accent)",
                  background: "none",
                  border: `1px solid ${voiceoverLoading ? "var(--color-border)" : "rgba(59,130,246,0.4)"}`,
                  borderRadius: 5,
                  padding: "3px 8px",
                  cursor: voiceoverLoading ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  opacity: voiceoverLoading ? 0.7 : 1,
                  transition: "opacity 120ms, border-color 120ms, color 120ms",
                }}
                onMouseEnter={(e) => { if (!voiceoverLoading) { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.backgroundColor = "rgba(59,130,246,0.06)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = voiceoverLoading ? "var(--color-border)" : "rgba(59,130,246,0.4)"; e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                {voiceoverLoading ? (
                  <>
                    {/* Animated arc spinner — uses the global @keyframes spin */}
                    <svg
                      width={9}
                      height={9}
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      aria-hidden="true"
                      style={{ animation: "spin 0.8s linear infinite", transformOrigin: "5px 5px" }}
                    >
                      <circle cx="5" cy="5" r="3.5" strokeDasharray="11 6" />
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>
                    <svg width={9} height={9} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 1h4v5a2 2 0 0 1-4 0V1z" />
                      <path d="M1 5a4 4 0 0 0 8 0" />
                      <line x1="5" y1="9" x2="5" y2="10" />
                    </svg>
                    Generate Voiceover
                  </>
                )}
              </button>
            )}
          </div>
          {voiceoverError && (
            <p style={{ fontSize: 10, color: "var(--color-error, #ef4444)", margin: 0, lineHeight: 1.4 }}>
              {voiceoverError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}
