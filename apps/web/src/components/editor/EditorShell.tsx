"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AspectRatio, EditorProject, Scene, TextOverlay } from "@/lib/editorProjectTypes";
import type { ArtifactRef } from "@aistudio/shared";
import { afterRemove, afterMove, afterReorder, afterDurationEdit, resolvePlayStart, resolveReplay, resolveActiveId } from "@/lib/playbackCoherence";
import { totalDurationMs, sceneStartMs, activeSceneIndex, clampDurationS, DEFAULT_VIDEO_DURATION_S, DEFAULT_IMAGE_DURATION_S } from "@/lib/sceneTiming";
import { buildRenderPlan } from "@/lib/renderPlan";
import { EditorToolbar } from "./EditorToolbar";
import { SceneList } from "./SceneList";
import { PreviewPlayer } from "./PreviewPlayer";
import { SceneInspector } from "./SceneInspector";
import { ArtifactPickerModal } from "./ArtifactPickerModal";
import { ArtifactPreviewPanel } from "@/components/prompt/ArtifactPreviewPanel";
import type { SaveState } from "./EditorToolbar";
import { useExportJob } from "@/hooks/useExportJob";
import { hasRenderResult, toArtifactPreviewable, formatDurationMs } from "@/lib/exportJobStatus";

interface EditorShellProps {
  project: EditorProject;
}

export function EditorShell({ project }: EditorShellProps) {
  const [scenes, setScenes] = useState<Scene[]>(project.scenes);
  const [projectName, setProjectName] = useState(project.name);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(project.aspectRatio);
  const [selectedId, setSelectedId] = useState<string | null>(
    project.scenes[0]?.id ?? null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [audioTrack, setAudioTrack] = useState<import("@/lib/editorProjectTypes").AudioTrack | null>(
    project.audioTrack ?? null,
  );
  // Default to true when any existing scene already has a text overlay so captions
  // are visible on projects that already have overlay data.
  const [autoCaptionsEnabled, setAutoCaptionsEnabled] = useState(
    () => project.scenes.some((s) => !!s.textOverlay),
  );
  const [voiceoverLoading, setVoiceoverLoading] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);
  const [voiceoverSuccess, setVoiceoverSuccess] = useState(false);
  const { state: exportState, jobStatus: exportJobStatus, error: exportError, exportMode, startedAt, trigger: triggerExport, reset: resetExport } = useExportJob(project.id);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [seekOffsetMs, setSeekOffsetMs] = useState(0); // intra-scene offset set by seek; 0 on normal play/advance
  const [isScrubbing, setIsScrubbing] = useState(false); // true while user is dragging the progress bar
  const [isLooping, setIsLooping] = useState(false);
  const [playEpoch, setPlayEpoch] = useState(0); // increments to signal PreviewPlayer to reset elapsed clock
  const isLoopingRef = useRef(isLooping);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);

  // Resolve selected scene; fall back to first when selectedId no longer exists
  const selectedScene =
    scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;

  // Single active-scene authority: follows playIndex while playing, selectedId while paused
  const activeId = resolveActiveId(scenes, playIndex, selectedId, isPlaying);
  // Active scene object used by PreviewPlayer and Inspector
  const activeScene = scenes.find((s) => s.id === activeId) ?? null;
  // Canonical render plan — pre-computes all timeline positions and fade windows
  const plan = buildRenderPlan(scenes);

  // ── Scene mutations ────────────────────────────────────────────────────────

  const handleMoveScene = useCallback((idx: number, dir: "up" | "down") => {
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= scenes.length) return;
    setScenes((prev) => {
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      return next;
    });
    const { playIndex: newIdx } = afterMove(scenes, { playIndex, seekOffsetMs }, idx, dir);
    if (newIdx !== playIndex) setPlayIndex(newIdx);
    setIsDirty(true);
  }, [scenes, playIndex, seekOffsetMs]);

  const handleRemoveScene = useCallback(
    (idx: number) => {
      const result = afterRemove(scenes, { playIndex, seekOffsetMs }, idx);
      setScenes((prev) => {
        const removed = prev[idx];
        const next = prev.filter((_, i) => i !== idx);
        // Keep selection valid: move to adjacent when the selected scene is removed
        if (removed && removed.id === selectedId) {
          setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null);
        }
        return next;
      });
      if (result.stop) setIsPlaying(false);
      setPlayIndex(result.playIndex);
      setSeekOffsetMs(result.seekOffsetMs);
      if (result.bump) setPlayEpoch((e) => e + 1);
      setIsDirty(true);
    },
    [scenes, playIndex, seekOffsetMs, selectedId],
  );

  const handleDurationChange = useCallback((idx: number, duration: number) => {
    setScenes((prev) => {
      const next = [...prev];
      const scene = next[idx];
      if (scene) next[idx] = { ...scene, duration };
      return next;
    });
    const { seekOffsetMs: newSeek } = afterDurationEdit({ playIndex, seekOffsetMs }, idx, duration);
    if (newSeek !== seekOffsetMs) setSeekOffsetMs(newSeek);
    setIsDirty(true);
  }, [playIndex, seekOffsetMs]);

  const handleOverlayChange = useCallback(
    (overlay: TextOverlay | null) => {
      setScenes((prev) =>
        prev.map((s) => {
          if (s.id !== selectedScene?.id) return s;
          const { textOverlay: _removed, ...rest } = s;
          return overlay ? { ...rest, textOverlay: overlay } : rest;
        }),
      );
      setIsDirty(true);
    },
    [selectedScene?.id],
  );

  const handleSceneDurationChange = useCallback(
    (duration: number) => {
      const editedIdx = scenes.findIndex((s) => s.id === selectedScene?.id);
      setScenes((prev) =>
        prev.map((s) => (s.id === selectedScene?.id ? { ...s, duration } : s)),
      );
      if (editedIdx >= 0) {
        const { seekOffsetMs: newSeek } = afterDurationEdit({ playIndex, seekOffsetMs }, editedIdx, duration);
        if (newSeek !== seekOffsetMs) setSeekOffsetMs(newSeek);
      }
      setIsDirty(true);
    },
    [selectedScene?.id, scenes, playIndex, seekOffsetMs],
  );

  const handleSceneTransitionChange = useCallback(
    (transition: "cut" | "fade") => {
      setScenes((prev) =>
        prev.map((s) => {
          if (s.id !== selectedScene?.id) return s;
          const { transition: _removed, ...rest } = s;
          return transition === "fade" ? { ...rest, transition } : rest;
        }),
      );
      setIsDirty(true);
    },
    [selectedScene?.id],
  );

  const handleFadeDurationChange = useCallback(
    (ms: number) => {
      setScenes((prev) =>
        prev.map((s) => (s.id === selectedScene?.id ? { ...s, fadeDurationMs: ms } : s)),
      );
      setIsDirty(true);
    },
    [selectedScene?.id],
  );

  const handleAspectRatioChange = useCallback((ar: AspectRatio) => {
    setAspectRatio(ar);
    setIsDirty(true);
  }, []);

  /**
   * Called once per video scene when the thumbnail's metadata first loads.
   * Records `naturalDuration` and, for freshly-added scenes (duration still at
   * the 10 s video default), initialises `duration` to the detected clip length.
   */
  const handleVideoDurationDetected = useCallback((idx: number, naturalSecs: number) => {
    setScenes((prev) => {
      const scene = prev[idx];
      if (!scene || scene.type !== "video" || scene.naturalDuration !== undefined) return prev;
      const natural = clampDurationS(naturalSecs);
      const next = [...prev];
      // Adopt natural duration only if the scene is still at the placeholder default.
      // If the user already edited the duration, leave it untouched.
      const duration = scene.duration === DEFAULT_VIDEO_DURATION_S ? natural : scene.duration;
      next[idx] = { ...scene, naturalDuration: natural, duration };
      return next;
    });
    setIsDirty(true);
  }, []);

  /**
   * Called when the user drags a trim handle on a scene card (SceneList) or the
   * inspector trim bar. Updates both trimStart and duration simultaneously.
   */
  const handleTrimChange = useCallback((idx: number, trimStart: number, duration: number) => {
    setScenes((prev) => {
      const next = [...prev];
      const scene = next[idx];
      if (scene) {
        next[idx] = {
          ...scene,
          trimStart: trimStart > 0 ? trimStart : undefined,
          duration,
        };
      }
      return next;
    });
    const { seekOffsetMs: newSeek } = afterDurationEdit({ playIndex, seekOffsetMs }, idx, duration);
    if (newSeek !== seekOffsetMs) setSeekOffsetMs(newSeek);
    setIsDirty(true);
  }, [playIndex, seekOffsetMs]);

  /** Trim change for the selected scene (SceneInspector). */
  const handleSceneTrimChange = useCallback((trimStart: number, duration: number) => {
    const editedIdx = scenes.findIndex((s) => s.id === selectedScene?.id);
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== selectedScene?.id) return s;
        return { ...s, trimStart: trimStart > 0 ? trimStart : undefined, duration };
      }),
    );
    if (editedIdx >= 0) {
      const { seekOffsetMs: newSeek } = afterDurationEdit({ playIndex, seekOffsetMs }, editedIdx, duration);
      if (newSeek !== seekOffsetMs) setSeekOffsetMs(newSeek);
    }
    setIsDirty(true);
  }, [selectedScene?.id, scenes, playIndex, seekOffsetMs]);

  const handleReorderScenes = useCallback((newScenes: Scene[]) => {
    const { playIndex: newIdx } = afterReorder(scenes, { playIndex, seekOffsetMs }, newScenes);
    setScenes(newScenes);
    if (newIdx !== playIndex) setPlayIndex(newIdx);
    setIsDirty(true);
  }, [scenes, playIndex, seekOffsetMs]);

  // ── Playback ───────────────────────────────────────────────────────────────

  const handleToggleLoop = useCallback(() => setIsLooping((v) => !v), []);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      // Sync selection to current play position so paused preview matches progress bar
      const playingScene = scenes[playIndex];
      if (playingScene) setSelectedId(playingScene.id);
    } else {
      if (scenes.length === 0) return;
      // Restart from beginning when at/past end; otherwise preserve seek position
      const { playIndex: startIdx, seekOffsetMs: startOffset } =
        resolveReplay(scenes, playIndex, seekOffsetMs, selectedId);
      setPlayIndex(startIdx);
      setSeekOffsetMs(startOffset);
      setPlayEpoch((e) => e + 1);
      setIsPlaying(true);
    }
  }, [isPlaying, scenes, selectedId, playIndex, seekOffsetMs]);

  const handleScrubStart = useCallback(() => setIsScrubbing(true), []);
  const handleScrubEnd = useCallback(() => setIsScrubbing(false), []);

  const handleStepScene = useCallback((dir: "prev" | "next") => {
    if (scenes.length === 0) return;
    const targetIdx = dir === "next"
      ? Math.min(playIndex + 1, scenes.length - 1)
      : Math.max(playIndex - 1, 0);
    if (targetIdx === playIndex) return; // already at boundary
    setPlayIndex(targetIdx);
    setSeekOffsetMs(0);
    if (!isPlaying) setSelectedId(scenes[targetIdx]!.id);
    setPlayEpoch((e) => e + 1);
  }, [scenes, playIndex, isPlaying]);

  const handleSeek = useCallback((targetMs: number) => {
    if (scenes.length === 0) return;
    const clamped = Math.max(0, Math.min(targetMs, totalDurationMs(scenes)));
    const sceneIdx = activeSceneIndex(scenes, clamped);
    const offsetMs = clamped - sceneStartMs(scenes, sceneIdx);
    setPlayIndex(sceneIdx);
    setSeekOffsetMs(offsetMs);
    if (!isPlaying) setSelectedId(scenes[sceneIdx]!.id);
    setPlayEpoch((e) => e + 1);
  }, [scenes, isPlaying]);

  // Safety-net: clamp playIndex if it is ever left out of bounds.
  // Handlers resolve most cases proactively; this effect catches anything missed.
  useEffect(() => {
    if (scenes.length === 0) {
      setIsPlaying(false);
      setPlayIndex(0);
      setSeekOffsetMs(0);
    } else if (playIndex >= scenes.length) {
      setPlayIndex(scenes.length - 1);
      setSeekOffsetMs(0);
      setPlayEpoch((e) => e + 1);
    }
  }, [scenes.length, playIndex]);

  // Advance to the next scene after each scene's duration elapses (offset-aware; paused during scrub)
  useEffect(() => {
    if (!isPlaying || isScrubbing || scenes.length === 0) return;
    const scene = scenes[playIndex];
    if (!scene) { setIsPlaying(false); return; }
    const delay = Math.max(0, scene.duration * 1000 - seekOffsetMs);
    const timer = setTimeout(() => {
      const nextIdx = playIndex + 1;
      if (nextIdx >= scenes.length) {
        if (isLoopingRef.current) {
          setPlayIndex(0);
          setSeekOffsetMs(0);
          setPlayEpoch((e) => e + 1);
        } else {
          setIsPlaying(false);
          // Park seek at the exact end of the last scene so effectiveTimelineMs = total
          setSeekOffsetMs((scenes[playIndex]?.duration ?? 0) * 1000);
          setPlayEpoch((e) => e + 1);
          // Sync selection so paused preview matches the scene where playback ended
          setSelectedId(scenes[playIndex]?.id ?? null);
        }
      } else {
        setPlayIndex(nextIdx);
        setSeekOffsetMs(0);
        setPlayEpoch((e) => e + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [isPlaying, isScrubbing, playIndex, scenes, seekOffsetMs]);

  // ── Add scene from artifact picker ────────────────────────────────────────

  const handleAddScene = useCallback((ref: ArtifactRef) => {
    const isVideo = ref.mimeType.startsWith("video/");
    const newScene: Scene = {
      id: crypto.randomUUID(),
      type: isVideo ? "video" : "image",
      src: ref.path,
      // Video gets a placeholder that handleVideoDurationDetected will correct once
      // the thumbnail's metadata loads; image gets a sensible display window.
      duration: isVideo ? DEFAULT_VIDEO_DURATION_S : DEFAULT_IMAGE_DURATION_S,
    };
    setScenes((prev) => [...prev, newScene]);
    setSelectedId(newScene.id);
    setIsDirty(true);
    setPickerOpen(false);
  }, []);

  // ── Audio track ───────────────────────────────────────────────────────────

  const handleAudioChange = useCallback(
    (track: import("@/lib/editorProjectTypes").AudioTrack | null) => {
      setAudioTrack(track);
      setIsDirty(true);
      // When the track is removed, clear any stale voiceover feedback state so
      // the next "Generate Voiceover" attempt starts with a clean UI.
      if (!track) {
        setVoiceoverError(null);
        setVoiceoverSuccess(false);
      }
    },
    [],
  );

  const handleAudioPicked = useCallback((ref: ArtifactRef) => {
    setAudioTrack({ src: ref.path, volume: 1 });
    setIsDirty(true);
    setAudioPickerOpen(false);
  }, []);

  /**
   * Toggle auto-captions mode.
   * Enabling: bulk-applies an empty subtitle overlay to every scene that doesn't
   * already have one, so users can quickly fill in caption text per scene.
   * Disabling: non-destructive — existing overlays are left in place.
   */
  const handleToggleAutoCaptions = useCallback(() => {
    const enabling = !autoCaptionsEnabled;
    setAutoCaptionsEnabled(enabling);
    if (enabling) {
      setScenes((prev) =>
        prev.map((scene) =>
          scene.textOverlay
            ? scene
            : { ...scene, textOverlay: { text: "", position: "bottom" as const, style: "subtitle" as const } }
        )
      );
      setIsDirty(true);
    }
  }, [autoCaptionsEnabled]);

  // ── Voiceover generation ──────────────────────────────────────────────────

  // Clear the "no captions" error as soon as the user adds caption text to any
  // scene, so the error doesn't linger after they follow the instructions.
  useEffect(() => {
    if (!voiceoverError) return;
    if (scenes.some((s) => s.textOverlay?.text?.trim())) setVoiceoverError(null);
  }, [scenes, voiceoverError]);

  const handleGenerateVoiceover = useCallback(async () => {
    const hasCaptions = scenes.some((s) => s.textOverlay?.text?.trim());
    if (!hasCaptions) {
      setVoiceoverError("Add caption text to at least one scene first (CC → type in Scene inspector).");
      return;
    }
    setVoiceoverLoading(true);
    setVoiceoverError(null);
    setVoiceoverSuccess(false);
    try {
      const res = await fetch(`/api/editor-projects/${project.id}/voiceover`, {
        method: "POST",
      });
      const data = await res.json() as { audioTrack?: import("@/lib/editorProjectTypes").AudioTrack; message?: string };
      if (!res.ok) {
        setVoiceoverError(data.message ?? "Voiceover generation failed.");
        return;
      }
      if (data.audioTrack) {
        setAudioTrack(data.audioTrack);
        // The voiceover route already persists audioTrack to the DB — no need to
        // mark the project dirty here.  Any other unsaved changes (scene edits, etc.)
        // remain dirty as before.
        setVoiceoverSuccess(true);
        // Auto-dismiss the success badge after 3 s.
        setTimeout(() => setVoiceoverSuccess(false), 3000);
        // Enable captions so they're visible during the auto-play preview —
        // the user already authored them to drive the TTS.
        setAutoCaptionsEnabled(true);
        // Auto-play from the beginning so the user immediately hears the new voiceover.
        if (scenes.length > 0) {
          setPlayIndex(0);
          setSeekOffsetMs(0);
          setPlayEpoch((e) => e + 1);
          setIsPlaying(true);
        }
      }
    } catch {
      setVoiceoverError("Network error — could not reach voiceover endpoint.");
    } finally {
      setVoiceoverLoading(false);
    }
  }, [project.id, scenes]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/editor-projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, aspectRatio, scenes, audioTrack }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSaveState("saved");
      setIsDirty(false);
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  }, [project.id, projectName, aspectRatio, scenes, audioTrack]);

  // ── Playback keyboard shortcuts (Space / ArrowLeft / ArrowRight) ──────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === " ") {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleStepScene("next");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleStepScene("prev");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePlayPause, handleStepScene]);

  // ── Cmd/Ctrl+S shortcut ───────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      if (saveState === "saving") return;
      handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveState, handleSave]);

  // ── Cmd/Ctrl+E shortcut ───────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "e") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      if (exportState === "triggering" || exportState === "fetching") return;
      triggerExport();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportState, triggerExport]);

  // ── Escape: dismiss completed export status or preview modal ─────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (previewModalOpen) {
        e.preventDefault();
        setPreviewModalOpen(false);
        return;
      }
      if (exportState !== "done") return;
      e.preventDefault();
      resetExport();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportState, resetExport, previewModalOpen]);

  // ── Cmd/Ctrl+Shift+E: trigger preview render ──────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key !== "E") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      if (exportState === "triggering" || exportState === "fetching") return;
      triggerExport({ preview: true });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportState, triggerExport]);

  // ── Auto-open preview modal on preview job completion ─────────────────────

  useEffect(() => {
    if (
      exportMode === "preview" &&
      exportState === "done" &&
      exportJobStatus !== null &&
      hasRenderResult(exportJobStatus) &&
      exportJobStatus.renderResult.artifacts.length > 0
    ) {
      setPreviewModalOpen(true);
    }
  }, [exportMode, exportState, exportJobStatus]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        backgroundColor: "var(--color-bg-primary)",
      }}
    >
      <EditorToolbar
        projectId={project.id}
        name={projectName}
        aspectRatio={aspectRatio}
        saveState={saveState}
        isDirty={isDirty}
        onNameChange={(n) => {
          setProjectName(n);
          setIsDirty(true);
        }}
        onAspectRatioChange={handleAspectRatioChange}
        onSave={handleSave}
        exportState={exportState}
        exportJobStatus={exportJobStatus}
        exportError={exportError}
        exportMode={exportMode}
        startedAt={startedAt}
        onExport={triggerExport}
        onPreview={() => triggerExport({ preview: true })}
        onExportReset={resetExport}
        projectDurationMs={totalDurationMs(scenes)}
        hasAudio={!!audioTrack}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <SceneList
          scenes={scenes}
          activeId={activeId}
          onSelect={setSelectedId}
          onMove={handleMoveScene}
          onRemove={handleRemoveScene}
          onDurationChange={handleDurationChange}
          onTrimChange={handleTrimChange}
          onAddScene={() => setPickerOpen(true)}
          onReorder={handleReorderScenes}
          onVideoDurationDetected={handleVideoDurationDetected}
        />
        <PreviewPlayer
          scene={activeScene}
          scenes={scenes}
          plan={plan}
          playIndex={playIndex}
          playEpoch={playEpoch}
          seekOffsetMs={seekOffsetMs}
          isScrubbing={isScrubbing}
          aspectRatio={aspectRatio}
          isPlaying={isPlaying}
          canPlay={scenes.length > 0}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onScrubStart={handleScrubStart}
          onScrubEnd={handleScrubEnd}
          isLooping={isLooping}
          onToggleLoop={handleToggleLoop}
          audioTrack={audioTrack}
          onAudioChange={handleAudioChange}
          onAudioLoad={() => setAudioPickerOpen(true)}
          autoCaptionsEnabled={autoCaptionsEnabled}
          onToggleAutoCaptions={handleToggleAutoCaptions}
          onGenerateVoiceover={handleGenerateVoiceover}
          voiceoverLoading={voiceoverLoading}
          voiceoverError={voiceoverError}
          voiceoverSuccess={voiceoverSuccess}
        />
        {/* Right column: full export artifact panel when done; preview uses a modal instead */}
        {exportMode === "full" && exportState === "done" && exportJobStatus !== null && hasRenderResult(exportJobStatus) && exportJobStatus.renderResult.artifacts.length > 0 ? (
          <div
            style={{
              width: 360,
              flexShrink: 0,
              borderLeft: "1px solid var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
              overflowY: "auto",
              padding: 12,
            }}
          >
            {exportJobStatus.renderResult.artifacts.map((artifact) => (
              <ArtifactPreviewPanel
                key={artifact.path}
                result={toArtifactPreviewable(artifact)}
                label="Export Output"
                highlighted={false}
              />
            ))}
          </div>
        ) : (
          selectedScene && (
            <SceneInspector
              scene={selectedScene}
              hasNextScene={
                scenes.findIndex((s) => s.id === selectedScene.id) < scenes.length - 1
              }
              onDurationChange={handleSceneDurationChange}
              onAutoDuration={
                selectedScene.type === "video" && selectedScene.naturalDuration !== undefined
                  ? () => handleSceneDurationChange(selectedScene.naturalDuration!)
                  : undefined
              }
              onTransitionChange={handleSceneTransitionChange}
              onFadeDurationChange={handleFadeDurationChange}
              onOverlayChange={handleOverlayChange}
              onTrimChange={
                selectedScene.type === "video" && selectedScene.naturalDuration !== undefined
                  ? handleSceneTrimChange
                  : undefined
              }
            />
          )
        )}
      </div>

      {pickerOpen && (
        <ArtifactPickerModal
          onPick={handleAddScene}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {audioPickerOpen && (
        <ArtifactPickerModal
          onPick={handleAudioPicked}
          onClose={() => setAudioPickerOpen(false)}
        />
      )}

      {/* Preview render modal — auto-opens when a preview job completes */}
      {previewModalOpen && exportJobStatus !== null && hasRenderResult(exportJobStatus) && exportJobStatus.renderResult.artifacts.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preview render"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.72)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewModalOpen(false); }}
        >
          <div
            style={{
              position: "relative",
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              padding: 20,
              maxWidth: "min(720px, 92vw)",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                Preview Render
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "var(--color-text-muted)" }}>
                  {exportJobStatus.renderResult.sceneCount} scenes ·{" "}
                  {formatDurationMs(exportJobStatus.renderResult.totalDurationMs)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                aria-label="Close preview"
                title="Close (Esc)"
                style={{
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "4px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* Artifacts */}
            {exportJobStatus.renderResult.artifacts.map((artifact) => (
              <ArtifactPreviewPanel
                key={artifact.path}
                result={toArtifactPreviewable(artifact)}
                label="Preview Output"
                highlighted={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
