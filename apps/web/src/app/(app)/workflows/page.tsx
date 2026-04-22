"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";

// ── Quick-start template metadata (displayed on the dashboard above the project list) ──
// Descriptions and icons intentionally duplicated from WelcomeScreen so the dashboard
// is self-contained and WelcomeScreen.tsx doesn't need to be modified.
const QUICK_TEMPLATE_META = [
  {
    key: "quick-social-reel" as const,
    icon: "🎬",
    name: "Quick Social Reel",
    description: "Prompt → 9:16 image → 5-second video clip.",
  },
  {
    key: "product-promo" as const,
    icon: "📦",
    name: "Product Promo",
    description: "4 image variants, best-of-N scoring, social captions, export.",
  },
  {
    key: "story-highlight" as const,
    icon: "🎞",
    name: "Story Highlight",
    description: "Two parallel scene tracks (A & B), each image → video.",
  },
] as const;

interface Workflow {
  id: string;
  name: string;
  description: string;
  tags: string[];
  isPinned: boolean;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  lastRunError: string | null;
  updatedAt: string;
  createdAt: string;
  hasProvenanceNodes: boolean;
  revisionCount: number;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  graph: { nodes: Array<{ id: string; type: string }>; edges: unknown[] };
  createdAt: string;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // hadAny tracks whether this user has ever had workflows, distinguishing
  // first-time visitors (show WelcomeScreen) from returning users who deleted
  // all workflows (show plain empty state).  Written by fetchWorkflows at line ~204.
  const [hadAny, setHadAny] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("aiStudio.workflow.hadAny") === "1",
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    const p = new URLSearchParams(window.location.search);
    return p.get("search") ?? localStorage.getItem("aiStudio.workflow.search") ?? "";
  });
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descInput, setDescInput] = useState("");
  const [descSaving, setDescSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Tracks which quick-start template card is mid-creation so we can show a per-card spinner.
  const [quickStartKey, setQuickStartKey] = useState<string | null>(null);
  const [starterKey, setStarterKey] = useState<"blank" | "image" | "text" | "quick-social-reel" | "product-promo" | "story-highlight" | "template">("blank");
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [hasNoProviders, setHasNoProviders] = useState(false);
  const [providerBannerDismissed, setProviderBannerDismissed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("aiStudio.noProviderBanner.dismissed") === "1",
  );
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null);
  const [templateRenameInput, setTemplateRenameInput] = useState("");
  const [templateRenameSaving, setTemplateRenameSaving] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    const urlTag = p.get("tag");
    if (urlTag !== null) return urlTag || null;
    return localStorage.getItem("aiStudio.workflow.tag") || null;
  });
  const [sortBy, setSortBy] = useState<"updated" | "lastRun" | "name" | "checkpoints">(() => {
    if (typeof window === "undefined") return "updated";
    const p = new URLSearchParams(window.location.search);
    const urlSort = p.get("sort");
    if (urlSort === "lastRun" || urlSort === "name" || urlSort === "updated") return urlSort;
    const v = localStorage.getItem("aiStudio.workflow.sort");
    return (v === "lastRun" || v === "name") ? v : "updated";
  });

  const [copied, setCopied] = useState(false);
  const [copiedWorkflowId, setCopiedWorkflowId] = useState<string | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    const p = new URLSearchParams(window.location.search);
    if (p.has("pinned")) return p.get("pinned") === "1";
    return localStorage.getItem("aiStudio.workflow.pinned") === "1";
  });
  const [hasCheckpointsFilter, setHasCheckpointsFilter] = useState(false);
  const [hasProvenanceFilter, setHasProvenanceFilter] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmYesRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkExportProgress, setBulkExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [keyboardWorkflowId, setKeyboardWorkflowId] = useState<string | null>(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const shortcutHelpRef = useRef<HTMLDivElement | null>(null);
  const shortcutTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shortcutPanelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const keyboardWorkflowIdRef = useRef<string | null>(null);
  const activeWorkflowIdRef = useRef<string | null>(null);
  const filteredRef = useRef<Workflow[]>([]);
  const cardElsRef = useRef<Map<string, HTMLAnchorElement>>(new Map());

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  }

  async function handleBulkPin(pin: boolean) {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) =>
        fetch(`/api/workflows/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPinned: pin }),
        }),
      ));
      setWorkflows((prev) => prev.map((w) => selectedIds.has(w.id) ? { ...w, isPinned: pin } : w));
      clearSelection();
    } finally {
      setBulkWorking(false);
    }
  }

  async function handleBulkDelete() {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) =>
        fetch(`/api/workflows/${id}`, { method: "DELETE" }),
      ));
      setWorkflows((prev) => prev.filter((w) => !selectedIds.has(w.id)));
      clearSelection();
    } finally {
      setBulkWorking(false);
    }
  }

  async function handleBulkExport() {
    const ids = [...selectedIds];
    const total = ids.length;
    setBulkWorking(true);
    setBulkExportProgress({ done: 0, total });
    try {
      for (let i = 0; i < ids.length; i++) {
        const w = workflows.find((x) => x.id === ids[i]);
        if (w) await handleExport(ids[i], w.name);
        setBulkExportProgress({ done: i + 1, total });
      }
      clearSelection();
    } finally {
      setBulkWorking(false);
      setBulkExportProgress(null);
    }
  }

  async function handleTogglePin(id: string, current: boolean) {
    setPinningId(id);
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned: !current }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, isPinned: !current } : w));
    } finally {
      setPinningId(null);
    }
  }

  async function handleCopyLink() {
    if (typeof navigator === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fetchWorkflows = useCallback(async () => {
    const res = await fetch("/api/workflows");
    if (res.ok) {
      const data = await res.json();
      setWorkflows(data);
      if (data.length > 0) localStorage.setItem("aiStudio.workflow.hadAny", "1");
    }
    setLoading(false);
  }, []);

  const fetchTemplates = useCallback(async () => {
    const res = await fetch("/api/templates");
    if (res.ok) setTemplates(await res.json());
  }, []);

  useEffect(() => { fetchWorkflows(); fetchTemplates(); }, [fetchWorkflows, fetchTemplates]);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.ok ? r.json() : [])
      .then((rows: unknown[]) => setHasNoProviders(rows.length === 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    function close() { setOpenMenuId(null); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setOpenMenuId(null); menuTriggerRef.current?.focus(); } }
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  useEffect(() => {
    if (!openMenuId) return;
    const t = setTimeout(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      first?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [openMenuId]);

  useEffect(() => {
    if (!deletingId) return;
    const t = setTimeout(() => { deleteConfirmYesRef.current?.focus(); }, 0);
    return () => clearTimeout(t);
  }, [deletingId]);

  useEffect(() => {
    if (!showShortcutHelp) return;
    const t = setTimeout(() => { shortcutPanelRef.current?.focus(); }, 0);
    return () => clearTimeout(t);
  }, [showShortcutHelp]);

  // Cmd+F / Ctrl+F → focus the workflow search input instead of browser find
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const el = searchInputRef.current;
        if (el) { el.focus(); el.select(); }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // Persist to localStorage
    localStorage.setItem("aiStudio.workflow.search", search);
    if (activeTag) localStorage.setItem("aiStudio.workflow.tag", activeTag);
    else localStorage.removeItem("aiStudio.workflow.tag");
    localStorage.setItem("aiStudio.workflow.sort", sortBy);
    if (pinnedOnly) localStorage.setItem("aiStudio.workflow.pinned", "1");
    else localStorage.removeItem("aiStudio.workflow.pinned");
    // Sync URL (replace so search typing doesn't pollute history)
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (activeTag) params.set("tag", activeTag);
    if (sortBy !== "updated") params.set("sort", sortBy);
    if (pinnedOnly) params.set("pinned", "1");
    const qs = params.toString();
    router.replace(qs ? `/workflows?${qs}` : "/workflows");
  }, [search, activeTag, sortBy, pinnedOnly, router]);

  function startRename(id: string, currentName: string) {
    setRenamingId(id);
    setRenameInput(currentName);
    setRenameError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameInput("");
    setRenameError(null);
  }

  async function commitRename(id: string) {
    const trimmed = renameInput.trim();
    if (!trimmed) { cancelRename(); return; }
    const current = workflows.find((w) => w.id === id)?.name ?? "";
    if (trimmed === current) { cancelRename(); return; }

    setRenameSaving(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setWorkflows((prev) =>
        prev.map((w) => w.id === id ? { ...w, name: trimmed } : w),
      );
      setRenamingId(null);
      setRenameInput("");
    } catch {
      setRenameError("Rename failed — please try again");
    } finally {
      setRenameSaving(false);
    }
  }

  async function handleSaveAsTemplate(id: string) {
    setSavingTemplateId(id);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceWorkflowId: id }),
      });
      if (res.ok) await fetchTemplates();
    } finally {
      setSavingTemplateId(null);
    }
  }

  async function handleDeleteTemplate(id: string) {
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (selectedTemplateId === id) {
      setSelectedTemplateId(null);
      setStarterKey("blank");
    }
  }

  async function handleRenameTemplate(id: string) {
    const trimmed = templateRenameInput.trim();
    if (!trimmed || templateRenameSaving) return;
    setTemplateRenameSaving(true);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, name: trimmed } : t));
        setRenamingTemplateId(null);
      }
    } finally {
      setTemplateRenameSaving(false);
    }
  }

  async function handleRun(id: string) {
    if (runningId) return;
    setRunningId(id);
    setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, lastRunStatus: "running", lastRunAt: new Date().toISOString() } : w));
    try {
      await fetch(`/api/workflows/${id}/runs`, { method: "POST" });
    } finally {
      setRunningId(null);
    }
  }

  async function handleDuplicate(id: string) {
    setDuplicatingId(id);
    try {
      const res = await fetch(`/api/workflows/${id}/duplicate`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        router.push(`/workflows/${data.id}`);
      }
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    if (res.ok) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      setDeletingId(null);
    } else {
      setDeleteError("Failed to delete — please try again");
      setDeletingId(null);
    }
  }

  const STARTER_GRAPHS: Record<string, object | undefined> = {
    blank: undefined,
    image: {
      version: 1,
      nodes: [
        { id: "tpl-1", type: "prompt-template", data: { label: "Prompt Template", params: { template: "A {{style}} photo of {{subject}}" } }, position: { x: 80, y: 160 } },
        { id: "gen-1", type: "image-generation", data: { label: "Image Generation", params: {} }, position: { x: 380, y: 160 } },
        { id: "out-1", type: "output", data: { label: "Result", params: {} }, position: { x: 680, y: 160 } },
      ],
      edges: [
        { id: "e1", source: "tpl-1", target: "gen-1", sourceHandle: "text_out", targetHandle: "prompt_in" },
        { id: "e2", source: "gen-1", target: "out-1", sourceHandle: "image_out", targetHandle: "input" },
      ],
    },
    text: {
      version: 1,
      nodes: [
        { id: "tpl-1", type: "prompt-template", data: { label: "Prompt Template", params: { template: "Write a {{tone}} post about {{topic}}" } }, position: { x: 80, y: 160 } },
        { id: "out-1", type: "output", data: { label: "Result", params: {} }, position: { x: 380, y: 160 } },
      ],
      edges: [
        { id: "e1", source: "tpl-1", target: "out-1", sourceHandle: "text_out", targetHandle: "input" },
      ],
    },
    "quick-social-reel": {
      version: 1,
      nodes: [
        { id: "qsr-1", type: "prompt-template", data: { label: "Scene Prompt", params: { template: "A cinematic {{style}} shot of {{subject}}, high quality, vivid colors" } }, position: { x: 80, y: 160 } },
        { id: "qsr-2", type: "image-generation", data: { label: "Image Generation", params: { width: 576, height: 1024, num_inference_steps: 28, guidance_scale: 7.5, seed: -1 } }, position: { x: 380, y: 160 } },
        { id: "qsr-3", type: "video-generation", data: { label: "Video Generation", params: { duration: 5, resolution: "720p", seed: -1 } }, position: { x: 700, y: 160 } },
      ],
      edges: [
        { id: "qsr-e1", source: "qsr-1", target: "qsr-2", sourceHandle: "text_out", targetHandle: "prompt_in" },
        { id: "qsr-e2", source: "qsr-1", target: "qsr-3", sourceHandle: "text_out", targetHandle: "prompt_in" },
        { id: "qsr-e3", source: "qsr-2", target: "qsr-3", sourceHandle: "image_out", targetHandle: "image_in" },
      ],
    },
    "product-promo": {
      version: 1,
      nodes: [
        { id: "pp-1", type: "prompt-template", data: { label: "Product Prompt", params: { template: "A professional product photo of {{product}}, studio lighting, clean background" } }, position: { x: 80, y: 160 } },
        { id: "pp-2", type: "best-of-n", data: { label: "Best of N (4 variants)", params: { n: 4, k: 1, provider: "mock", model: "mock-sdxl" } }, position: { x: 380, y: 160 } },
        { id: "pp-3", type: "social-format", data: { label: "Social Format", params: { platforms: ["instagram", "x", "linkedin"], tone: "professional", includeHashtags: true, includeCTA: true } }, position: { x: 700, y: 160 } },
        { id: "pp-4", type: "export-bundle", data: { label: "Export Bundle", params: { format: "manifest-only", includeImages: true, includeMetadata: true, includeSocialText: true, includeScores: true } }, position: { x: 1020, y: 160 } },
      ],
      edges: [
        { id: "pp-e1", source: "pp-1", target: "pp-2", sourceHandle: "text_out", targetHandle: "prompt_in" },
        { id: "pp-e2", source: "pp-2", target: "pp-3", sourceHandle: "selection_out", targetHandle: "candidates_in" },
        { id: "pp-e3", source: "pp-3", target: "pp-4", sourceHandle: "formatted_out", targetHandle: "candidates_in" },
      ],
    },
    "story-highlight": {
      version: 1,
      nodes: [
        { id: "sh-1", type: "prompt-template", data: { label: "Scene Prompt", params: { template: "A {{mood}} scene of {{setting}}, cinematic lighting, wide shot" } }, position: { x: 80, y: 200 } },
        { id: "sh-2", type: "image-generation", data: { label: "Scene A — Image", params: { width: 1280, height: 720, seed: 42 } }, position: { x: 380, y: 60 } },
        { id: "sh-3", type: "video-generation", data: { label: "Scene A — Video", params: { duration: 5, resolution: "720p", seed: 42 } }, position: { x: 700, y: 60 } },
        { id: "sh-4", type: "image-generation", data: { label: "Scene B — Image", params: { width: 1280, height: 720, seed: 99 } }, position: { x: 380, y: 340 } },
        { id: "sh-5", type: "video-generation", data: { label: "Scene B — Video", params: { duration: 5, resolution: "720p", seed: 99 } }, position: { x: 700, y: 340 } },
      ],
      edges: [
        { id: "sh-e1", source: "sh-1", target: "sh-2", sourceHandle: "text_out", targetHandle: "prompt_in" },
        { id: "sh-e2", source: "sh-1", target: "sh-4", sourceHandle: "text_out", targetHandle: "prompt_in" },
        { id: "sh-e3", source: "sh-2", target: "sh-3", sourceHandle: "image_out", targetHandle: "image_in" },
        { id: "sh-e4", source: "sh-4", target: "sh-5", sourceHandle: "image_out", targetHandle: "image_in" },
      ],
    },
  };

  /** Create a workflow directly from a graph object and navigate to the canvas.
   *  Used by the WelcomeScreen template cards and quick-start CTAs. */
  async function createFromGraph(graph: object, name: string) {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, graph }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/workflows/${data.id}`);
      } else {
        setCreating(false);
      }
    } catch {
      setCreating(false);
    }
  }

  /** Dismiss the welcome screen permanently by marking the user as having had workflows. */
  function handleDismissWelcome() {
    localStorage.setItem("aiStudio.workflow.hadAny", "1");
    setHadAny(true);
  }

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    let graph: object | undefined = STARTER_GRAPHS[starterKey] as object | undefined;
    if (starterKey === "template" && selectedTemplateId) {
      graph = templates.find((t) => t.id === selectedTemplateId)?.graph;
    }
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDesc, ...(graph ? { graph } : {}) }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/workflows/${data.id}`);
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateError(data.message || "Failed to create workflow — please try again");
        setCreating(false);
      }
    } catch {
      setCreateError("Connection error — please try again");
      setCreating(false);
    }
  }

  async function handleExport(id: string, name: string) {
    setExportingId(id);
    try {
      const res = await fetch(`/api/workflows/${id}/export`);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `${name}.workflow.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingId(null);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setImportError("File is not valid JSON");
        return;
      }
      const res = await fetch("/api/workflows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/workflows/${data.id}`);
      } else {
        const data = await res.json().catch(() => ({}));
        setImportError(data.message || "Import failed — please try again");
      }
    } catch {
      setImportError("Connection error — please try again");
    } finally {
      setImporting(false);
    }
  }

  function startEditDesc(id: string, current: string) {
    setEditingDescId(id);
    setDescInput(current);
  }

  function cancelEditDesc() {
    setEditingDescId(null);
    setDescInput("");
  }

  async function commitDesc(id: string) {
    const trimmed = descInput.trim();
    setDescSaving(true);
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, description: trimmed } : w));
      setEditingDescId(null);
      setDescInput("");
    } catch {
      // leave edit open so user can retry
    } finally {
      setDescSaving(false);
    }
  }

  function startEditTags(id: string, current: string[]) {
    setEditingTagsId(id);
    setTagInput(current.join(", "));
  }

  function cancelEditTags() {
    setEditingTagsId(null);
    setTagInput("");
  }

  async function commitTags(id: string) {
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setTagSaving(true);
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, tags } : w));
      setEditingTagsId(null);
      setTagInput("");
    } catch {
      // leave edit open so user can retry
    } finally {
      setTagSaving(false);
    }
  }

  const allTags = Array.from(
    new Set(workflows.flatMap((w) => w.tags ?? []).filter(Boolean)),
  ).sort();

  const q = search.trim().toLowerCase();
  const filtered = workflows
    .filter((w) => {
      const matchesSearch = !q ||
        w.name.toLowerCase().includes(q) ||
        (w.description ?? "").toLowerCase().includes(q) ||
        (w.tags ?? []).some((t) => t.toLowerCase().includes(q));
      const matchesTag = activeTag === null || (w.tags ?? []).includes(activeTag);
      const matchesPin = !pinnedOnly || w.isPinned;
      const matchesCheckpoints = !hasCheckpointsFilter || (w.revisionCount ?? 0) > 0;
      const matchesProvenance = !hasProvenanceFilter || w.hasProvenanceNodes;
      return matchesSearch && matchesTag && matchesPin && matchesCheckpoints && matchesProvenance;
    })
    .slice()
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "lastRun") {
        if (!a.lastRunAt && !b.lastRunAt) return 0;
        if (!a.lastRunAt) return 1;
        if (!b.lastRunAt) return -1;
        return b.lastRunAt.localeCompare(a.lastRunAt);
      }
      if (sortBy === "checkpoints") return (b.revisionCount ?? 0) - (a.revisionCount ?? 0);
      // default: updated
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  filteredRef.current = filtered;
  activeWorkflowIdRef.current = activeWorkflowId;

  // True when the list is showing all workflows with no search or filter active.
  // Used to decide whether to show the quick-start strip and "Recent Projects" heading.
  const isUnfiltered =
    !search.trim() && !activeTag && !pinnedOnly && !hasCheckpointsFilter && !hasProvenanceFilter;

  // Clear stale keyboard selection when the selected workflow is no longer in the filtered list
  if (keyboardWorkflowId && !filtered.some((w) => w.id === keyboardWorkflowId)) {
    setKeyboardWorkflowId(null);
    keyboardWorkflowIdRef.current = null;
    if (activeWorkflowId === keyboardWorkflowId) {
      setActiveWorkflowId(null);
      activeWorkflowIdRef.current = null;
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setSelectedIds(new Set(filtered.map((w) => w.id)));
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        setBulkDeleteConfirm(false);
        setShowShortcutHelp(false);
        if (deletingId) { setDeletingId(null); deleteTriggerRef.current?.focus(); }
      }
      if (e.key === "e" || e.key === "E") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        handleExport(w.id, w.name);
      }
      if (e.key === "d" || e.key === "D") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        if (duplicatingId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        handleDuplicate(w.id);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        if (deletingId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        deleteTriggerRef.current = document.activeElement as HTMLElement;
        setDeletingId(w.id);
      }
      if (e.key === "p" || e.key === "P") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        if (pinningId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        handleTogglePin(w.id, w.isPinned);
      }
      if (e.key === "r" || e.key === "R") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        if (renamingId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        startRename(w.id, w.name);
      }
      if (e.key === "x" || e.key === "X") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        if (runningId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        handleRun(w.id);
      }
      if (e.key === "Enter") {
        if (!activeWorkflowId) return;
        e.preventDefault();
        router.push(`/workflows/${activeWorkflowId}`);
      }
      if (e.key === "c" || e.key === "C") {
        if (e.metaKey || e.ctrlKey) return;
        if (!activeWorkflowId) return;
        e.preventDefault();
        navigator.clipboard.writeText(activeWorkflowId).then(() => {
          setCopiedWorkflowId(activeWorkflowId);
          setTimeout(() => setCopiedWorkflowId((prev) => prev === activeWorkflowId ? null : prev), 1500);
        }).catch(() => {});
      }
      if (e.key === "e" || e.key === "E") {
        if (bulkWorking) return;
        if (!activeWorkflowId) return;
        const w = filtered.find((x) => x.id === activeWorkflowId);
        if (!w) return;
        e.preventDefault();
        handleExport(w.id, w.name);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, bulkWorking, activeWorkflowId, duplicatingId, deletingId, pinningId, renamingId, runningId, router]);

  // ↑ / ↓ → navigate between workflow cards
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const rows = filteredRef.current;
      if (rows.length === 0) return;
      e.preventDefault();
      const currentId = activeWorkflowIdRef.current;
      const idx = currentId ? rows.findIndex((r) => r.id === currentId) : -1;
      const nextIdx = e.key === "ArrowDown"
        ? (idx === -1 ? 0 : Math.min(idx + 1, rows.length - 1))
        : (idx === -1 ? rows.length - 1 : Math.max(idx - 1, 0));
      const nextId = rows[nextIdx]?.id ?? null;
      keyboardWorkflowIdRef.current = nextId;
      setKeyboardWorkflowId(nextId);
      setActiveWorkflowId(nextId);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll keyboard-selected workflow card into view
  useEffect(() => {
    if (keyboardWorkflowId) {
      cardElsRef.current.get(keyboardWorkflowId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [keyboardWorkflowId]);

  useEffect(() => {
    if (!showShortcutHelp) return;
    function onMouseDown(e: MouseEvent) {
      if (shortcutHelpRef.current && !shortcutHelpRef.current.contains(e.target as Node)) {
        setShowShortcutHelp(false);
        shortcutTriggerRef.current?.focus();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setShowShortcutHelp(false); shortcutTriggerRef.current?.focus(); }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showShortcutHelp]);

  // Refresh run statuses when the user returns to the page from another tab/window.
  // Merges only changed lastRunStatus/lastRunAt to avoid clobbering in-progress edits.
  const lastRunRefreshRef = useRef<number>(0);
  useEffect(() => {
    function refresh() {
      const now = Date.now();
      if (now - lastRunRefreshRef.current < 500) return;
      lastRunRefreshRef.current = now;
      fetch("/api/workflows")
        .then((r) => r.ok ? r.json() : null)
        .then((rows: Workflow[] | null) => {
          if (!rows) return;
          setWorkflows((prev) => prev.map((w) => {
            const fresh = rows.find((r) => r.id === w.id);
            if (!fresh) return w;
            if (fresh.lastRunStatus === w.lastRunStatus && fresh.lastRunAt === w.lastRunAt) return w;
            return { ...w, lastRunStatus: fresh.lastRunStatus, lastRunAt: fresh.lastRunAt, lastRunError: fresh.lastRunError };
          }));
        })
        .catch(() => { /* silent */ });
    }
    function onVisibility() { if (document.visibilityState === "visible") refresh(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <div style={{ padding: 32 }}>
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", whiteSpace: "nowrap", clip: "rect(0,0,0,0)" }}
      >
        {copiedWorkflowId ? "Workflow ID copied" : ""}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: workflows.length > 0 ? 16 : 32,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text-primary)" }}>
          Workflows
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {templates.length > 0 && (
            <button
              onClick={() => setShowModal(true)}
              style={{
                padding: "6px 12px",
                backgroundColor: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: 20,
                color: "var(--color-text-muted)",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
              title="Open New Workflow modal to use saved templates"
            >
              <span style={{ opacity: 0.7 }}>📄</span>
              {templates.length} saved template{templates.length !== 1 ? "s" : ""}
            </button>
          )}
          <div ref={shortcutHelpRef} style={{ position: "relative" }}>
            <button
              ref={shortcutTriggerRef}
              onClick={() => setShowShortcutHelp((v) => !v)}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              aria-haspopup="dialog"
              aria-expanded={showShortcutHelp}
              style={{
                width: 32, height: 32,
                backgroundColor: showShortcutHelp ? "var(--color-surface-hover)" : "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ?
            </button>
            {showShortcutHelp && (
              <div
                ref={shortcutPanelRef}
                role="dialog"
                aria-label="Keyboard shortcuts reference"
                aria-modal="false"
                tabIndex={-1}
                style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  zIndex: 300,
                  minWidth: 220,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Keyboard Shortcuts
                </div>
                {([
                  ["↑ / ↓", "Navigate workflows"],
                  ["Enter", "Open focused workflow"],
                  ["C", "Copy focused workflow ID"],
                  ["X", "Run focused workflow"],
                  ["R", "Rename focused workflow"],
                  ["E", "Export focused workflow"],
                  ["D", "Duplicate focused workflow"],
                  ["P", "Pin / Unpin focused workflow"],
                  ["Del", "Open delete confirmation"],
                  ["⌘F / Ctrl F", "Focus search"],
                  ["⌘A / Ctrl A", "Select all"],
                  ["Esc", "Clear selection"],
                ] as [string, string][]).map(([key, desc]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <kbd style={{
                      display: "inline-block", minWidth: 52,
                      padding: "2px 6px", borderRadius: 5,
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      fontSize: 11, fontFamily: "inherit", fontWeight: 600,
                      color: "var(--color-text-secondary)",
                      textAlign: "center",
                    }}>
                      {key}
                    </kbd>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label
            style={{
              padding: "10px 16px",
              backgroundColor: "transparent",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: importing ? "default" : "pointer",
            }}
          >
            {importing ? "Importing…" : "Import"}
            <input
              type="file"
              accept=".json"
              style={{ display: "none" }}
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleImport(file);
              }}
            />
          </label>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: "10px 20px",
              backgroundColor: "var(--color-accent)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + New Workflow
          </button>
        </div>
      </div>

      {hasNoProviders && !providerBannerDismissed && !loading && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 16px",
            marginBottom: 20,
            backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)",
            borderRadius: 10,
            color: "var(--color-text-primary)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚡</span>
          <span style={{ flex: 1 }}>
            <strong>No providers configured.</strong> Add an API key in{" "}
            <Link
              href="/settings/providers"
              style={{ color: "var(--color-accent)", textDecoration: "underline" }}
            >
              Settings → Providers
            </Link>{" "}
            before running a workflow.
          </span>
          <button
            aria-label="Dismiss no-providers banner"
            onClick={() => {
              localStorage.setItem("aiStudio.noProviderBanner.dismissed", "1");
              setProviderBannerDismissed(true);
            }}
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: 16,
              lineHeight: 1,
              padding: "2px 4px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {workflows.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: allTags.length > 0 ? 12 : 20 }}>
          <input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (search) { e.preventDefault(); setSearch(""); }
                else (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search workflows… (⌘F)"
            style={{
              flex: "0 0 auto",
              width: 280,
              padding: "8px 12px",
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              color: "var(--color-text-primary)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
            Sort by
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "updated" | "lastRun" | "name" | "checkpoints")}
              style={{
                padding: "6px 10px",
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-text-primary)",
                fontSize: 13,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="updated">Last updated</option>
              <option value="lastRun">Last run</option>
              <option value="checkpoints">Most checkpoints</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
          <button
            onClick={handleCopyLink}
            style={{
              padding: "6px 12px", fontSize: 13,
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              color: copied ? "var(--color-accent)" : "var(--color-text-muted)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color 150ms ease",
            }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            onClick={() => setPinnedOnly((v) => !v)}
            style={{
              padding: "6px 12px", fontSize: 13,
              backgroundColor: pinnedOnly ? "var(--color-accent)" : "var(--color-surface)",
              border: "1px solid",
              borderColor: pinnedOnly ? "var(--color-accent)" : "var(--color-border)",
              borderRadius: 8,
              color: pinnedOnly ? "#fff" : "var(--color-text-muted)",
              cursor: "pointer",
              fontWeight: pinnedOnly ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            📌 Pinned
          </button>
          <button
            onClick={() => setHasCheckpointsFilter((v) => !v)}
            style={{
              padding: "6px 12px", fontSize: 13,
              backgroundColor: hasCheckpointsFilter ? "var(--color-accent)" : "var(--color-surface)",
              border: "1px solid",
              borderColor: hasCheckpointsFilter ? "var(--color-accent)" : "var(--color-border)",
              borderRadius: 8,
              color: hasCheckpointsFilter ? "#fff" : "var(--color-text-muted)",
              cursor: "pointer",
              fontWeight: hasCheckpointsFilter ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            Has Checkpoints
          </button>
          <button
            onClick={() => setHasProvenanceFilter((v) => !v)}
            style={{
              padding: "6px 12px", fontSize: 13,
              backgroundColor: hasProvenanceFilter ? "var(--color-accent)" : "var(--color-surface)",
              border: "1px solid",
              borderColor: hasProvenanceFilter ? "var(--color-accent)" : "var(--color-border)",
              borderRadius: 8,
              color: hasProvenanceFilter ? "#fff" : "var(--color-text-muted)",
              cursor: "pointer",
              fontWeight: hasProvenanceFilter ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            Artifact-Derived
          </button>
        </div>
      )}

      {allTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
          <button
            onClick={() => setActiveTag(null)}
            style={{
              fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
              backgroundColor: activeTag === null ? "var(--color-text-secondary)" : "var(--color-surface)",
              color: activeTag === null ? "var(--color-bg-primary)" : "var(--color-text-secondary)",
              cursor: "pointer", fontWeight: activeTag === null ? 600 : 400,
            }}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid",
                borderColor: activeTag === tag ? "var(--color-accent)" : "var(--color-border)",
                backgroundColor: activeTag === tag ? "var(--color-accent)" : "var(--color-surface)",
                color: activeTag === tag ? "#fff" : "var(--color-text-secondary)",
                cursor: "pointer", fontWeight: activeTag === tag ? 600 : 400,
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {(deleteError || importError) && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 8,
          backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          fontSize: 13, color: "var(--color-error)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          {importError || deleteError}
          <button
            onClick={() => { setDeleteError(null); setImportError(null); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)", fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
      ) : workflows.length === 0 ? (
        hadAny ? (
          /* Returning user who has no workflows — skip the welcome experience */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "80px 20px",
              border: "1px dashed var(--color-border)",
              borderRadius: 12,
              backgroundColor: "var(--color-surface)",
            }}
          >
            <p style={{ fontSize: 16, color: "var(--color-text-secondary)", marginBottom: 4 }}>
              No workflows right now.
            </p>
            <p style={{ fontSize: 14, color: "var(--color-text-muted)", marginBottom: 20 }}>
              You had workflows here before — create a new one to get started again.
            </p>
            <button
              onClick={() => setShowModal(true)}
              style={{
                padding: "10px 22px",
                backgroundColor: "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New Workflow
            </button>
          </div>
        ) : (
          /* First-time user — show the full welcome experience */
          <WelcomeScreen
            onCreateFromGraph={createFromGraph}
            onOpenModal={() => setShowModal(true)}
            onDismiss={handleDismissWelcome}
            creating={creating}
          />
        )
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 20px" }}>
          <p aria-live="polite" aria-atomic="true" style={{ fontSize: 16, color: "var(--color-text-secondary)", marginBottom: 16 }}>
            {(() => {
              const parts: string[] = [];
              if (search.trim()) parts.push("search");
              if (activeTag) parts.push("tag");
              if (pinnedOnly) parts.push("pinned");
              if (hasCheckpointsFilter) parts.push("checkpoints");
              if (hasProvenanceFilter) parts.push("provenance");
              if (parts.length === 0) return "No workflows found.";
              if (parts.length === 1 && parts[0] === "pinned") return "No pinned workflows.";
              return `No workflows match the active ${parts.join(" + ")} filter${parts.length > 1 ? "s" : ""}.`;
            })()}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            {search.trim() && (
              <button
                onClick={() => setSearch("")}
                style={{
                  padding: "7px 16px", fontSize: 13,
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8, color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Clear Search
              </button>
            )}
            {activeTag && (
              <button
                onClick={() => setActiveTag(null)}
                style={{
                  padding: "7px 16px", fontSize: 13,
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8, color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Clear Filter
              </button>
            )}
            {pinnedOnly && (
              <button
                onClick={() => setPinnedOnly(false)}
                style={{
                  padding: "7px 16px", fontSize: 13,
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8, color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Show All
              </button>
            )}
            {hasCheckpointsFilter && (
              <button
                onClick={() => setHasCheckpointsFilter(false)}
                style={{
                  padding: "7px 16px", fontSize: 13,
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8, color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Show All
              </button>
            )}
            {hasProvenanceFilter && (
              <button
                onClick={() => setHasProvenanceFilter(false)}
                style={{
                  padding: "7px 16px", fontSize: 13,
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8, color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Show All
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
        {/* ── Quick-start strip: shown only when no filter is active ── */}
        {isUnfiltered && (
          <div style={{ marginBottom: 28 }}>
            <p style={{
              fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.07em", color: "var(--color-text-muted)",
              margin: "0 0 10px",
            }}>
              New from Template
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {QUICK_TEMPLATE_META.map((tpl) => {
                const isCreatingThis = quickStartKey === tpl.key;
                return (
                  <div
                    key={tpl.key}
                    style={{
                      flex: "1 1 0", minWidth: 180,
                      padding: "14px 16px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 10,
                      backgroundColor: "var(--color-surface)",
                      display: "flex", flexDirection: "column", gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 18 }} aria-hidden="true">{tpl.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {tpl.name}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0, lineHeight: 1.45, flexGrow: 1 }}>
                      {tpl.description}
                    </p>
                    <button
                      disabled={creating}
                      aria-label={`Create a ${tpl.name} workflow`}
                      onClick={async () => {
                        const graph = STARTER_GRAPHS[tpl.key];
                        if (!graph) return;
                        setQuickStartKey(tpl.key);
                        await createFromGraph(graph, tpl.name);
                        setQuickStartKey(null); // only reached on API error
                      }}
                      onMouseEnter={(e) => {
                        if (!creating) e.currentTarget.style.backgroundColor = "var(--color-accent-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "var(--color-accent)";
                      }}
                      style={{
                        padding: "6px 12px",
                        fontSize: 12, fontWeight: 600,
                        backgroundColor: "var(--color-accent)",
                        color: "#fff",
                        border: "none", borderRadius: 7,
                        cursor: creating ? "default" : "pointer",
                        opacity: creating && !isCreatingThis ? 0.5 : 1,
                        alignSelf: "flex-start",
                        transition: "background-color 0.12s, opacity 0.12s",
                      }}
                    >
                      {isCreatingThis ? "Creating…" : "Use Template"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <span
          aria-live="polite"
          aria-atomic="true"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", whiteSpace: "nowrap", clip: "rect(0,0,0,0)" }}
        >
          {selectedIds.size > 0 ? `${selectedIds.size} workflow${selectedIds.size > 1 ? "s" : ""} selected` : ""}
        </span>
        {selectedIds.size > 0 && (
          <div
            role="toolbar"
            aria-label="Bulk workflow actions"
            style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            marginBottom: 12, padding: "10px 14px",
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-accent)",
            borderRadius: 10, fontSize: 13,
          }}>
            <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set(filtered.map((w) => w.id)))}
              style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
            >
              Select all ({filtered.length})
            </button>
            <span style={{ color: "var(--color-border)" }}>|</span>
            {bulkDeleteConfirm ? (
              <>
                <span style={{ color: "var(--color-error)", fontWeight: 500 }}>
                  Delete {selectedIds.size} workflow{selectedIds.size > 1 ? "s" : ""}?
                </span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkWorking}
                  aria-label={`Yes, delete ${selectedIds.size} selected workflow${selectedIds.size > 1 ? "s" : ""}`}
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--color-error)", background: "none", border: "none", cursor: bulkWorking ? "default" : "pointer", padding: "2px 6px" }}
                >
                  {bulkWorking ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setBulkDeleteConfirm(false)}
                  disabled={bulkWorking}
                  aria-label="Cancel bulk deletion"
                  style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleBulkPin(true)}
                  disabled={bulkWorking}
                  aria-label="Pin selected workflows"
                  style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: bulkWorking ? "default" : "pointer", padding: "2px 6px" }}
                >
                  Pin
                </button>
                <button
                  onClick={() => handleBulkPin(false)}
                  disabled={bulkWorking}
                  aria-label="Unpin selected workflows"
                  style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: bulkWorking ? "default" : "pointer", padding: "2px 6px" }}
                >
                  Unpin
                </button>
                <button
                  onClick={handleBulkExport}
                  disabled={bulkWorking}
                  aria-label="Export selected workflows"
                  style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: bulkWorking ? "default" : "pointer", padding: "2px 6px" }}
                >
                  Export
                </button>
                {bulkExportProgress && (
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", paddingLeft: 2 }}>
                    {bulkExportProgress.done} / {bulkExportProgress.total}…
                  </span>
                )}
                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={bulkWorking}
                  aria-label="Delete selected workflows"
                  style={{ fontSize: 12, color: "var(--color-error)", background: "none", border: "none", cursor: bulkWorking ? "default" : "pointer", padding: "2px 6px" }}
                >
                  Delete
                </button>
                <span style={{ color: "var(--color-border)" }}>|</span>
                <button
                  onClick={clearSelection}
                  style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
                >
                  Clear selection
                </button>
              </>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap", paddingLeft: 8 }}>
              ⌘A · Esc
            </span>
          </div>
        )}
        {/* ── Section heading: "Recent Projects" or filter result count ── */}
        {isUnfiltered ? (
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--color-text-muted)",
            margin: "0 0 10px",
          }}>
            Recent Projects
          </p>
        ) : (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 10px" }}>
            {filtered.length} workflow{filtered.length !== 1 ? "s" : ""} found
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((w) => (
            <Link
              key={w.id}
              ref={(el) => { if (el) cardElsRef.current.set(w.id, el); else cardElsRef.current.delete(w.id); }}
              href={`/workflows/${w.id}`}
              title={`${w.name}\n\nKeyboard shortcuts:\nEnter — Open  C — Copy ID  X — Run\nR — Rename  E — Export  D — Duplicate\nP — Pin  Del — Delete`}
              aria-label={`${w.name} — shortcuts: Enter Open, C Copy ID, X Run, R Rename, E Export, D Duplicate, P Pin, Del Delete`}
              style={{
                display: "block",
                padding: 16,
                backgroundColor: selectedIds.has(w.id) ? "var(--color-accent)0d" : "var(--color-surface)",
                border: `1px solid ${selectedIds.has(w.id) || keyboardWorkflowId === w.id ? "var(--color-accent)" : "var(--color-border)"}`,
                borderRadius: 10,
                textDecoration: "none",
                transition: "background-color 100ms ease",
                outline: keyboardWorkflowId === w.id ? "2px solid color-mix(in srgb, var(--color-accent) 30%, transparent)" : "none",
                outlineOffset: 1,
              }}
              onMouseEnter={(e) => {
                setActiveWorkflowId(w.id);
                keyboardWorkflowIdRef.current = null;
                setKeyboardWorkflowId(null);
                if (!selectedIds.has(w.id)) e.currentTarget.style.backgroundColor = "var(--color-surface-hover)";
              }}
              onMouseLeave={(e) => {
                setActiveWorkflowId(keyboardWorkflowIdRef.current);
                e.currentTarget.style.backgroundColor = selectedIds.has(w.id) ? "var(--color-accent)0d" : "var(--color-surface)";
              }}
              onFocus={() => setActiveWorkflowId(w.id)}
              onBlur={() => setActiveWorkflowId(keyboardWorkflowIdRef.current)}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span
                  style={{ marginRight: 10, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(w.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelect(w.id); }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={w.name}
                    style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--color-accent)" }}
                  />
                </span>
                {renamingId === w.id ? (
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <input
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(w.id); }
                        if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                      }}
                      disabled={renameSaving}
                      aria-label={`Rename workflow ${w.name}`}
                      aria-describedby={`rename-hint-${w.id}`}
                      style={{
                        flex: 1, maxWidth: 320,
                        padding: "3px 8px",
                        backgroundColor: "var(--color-bg-primary)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        color: "var(--color-text-primary)",
                        fontSize: 15,
                        fontWeight: 600,
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitRename(w.id); }}
                      disabled={renameSaving || !renameInput.trim()}
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", background: "none", border: "none", cursor: renameSaving ? "default" : "pointer", padding: "2px 4px" }}
                    >
                      {renameSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelRename(); }}
                      disabled={renameSaving}
                      style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
                    >
                      Cancel
                    </button>
                    <span id={`rename-hint-${w.id}`} style={{ fontSize: 11, color: "var(--color-text-muted)" }}>↵ to save · Esc to cancel</span>
                    {renameError && (
                      <span style={{ fontSize: 12, color: "var(--color-error)" }}>{renameError}</span>
                    )}
                  </span>
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: "var(--color-text-primary)" }}>
                      {w.name}
                    </span>
                    {w.isPinned && (
                      <span style={{ fontSize: 12, color: "var(--color-accent)", lineHeight: 1 }} title="Pinned">📌</span>
                    )}
                  </span>
                )}
                {w.lastRunStatus && renamingId !== w.id && (
                  <StatusBadge status={w.lastRunStatus} />
                )}
              </div>
              {editingDescId === w.id ? (
                <span
                  style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <textarea
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={descInput}
                    onChange={(e) => setDescInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { e.preventDefault(); cancelEditDesc(); }
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); commitDesc(w.id); }
                    }}
                    disabled={descSaving}
                    rows={3}
                    placeholder="Add a description…"
                    aria-label={`Edit description for ${w.name}`}
                    aria-describedby={`desc-hint-${w.id}`}
                    style={{
                      width: "100%", padding: "6px 8px",
                      backgroundColor: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6, color: "var(--color-text-primary)",
                      fontSize: 13, resize: "vertical", outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitDesc(w.id); }}
                      disabled={descSaving}
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", background: "none", border: "none", cursor: descSaving ? "default" : "pointer", padding: "2px 4px" }}
                    >
                      {descSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelEditDesc(); }}
                      disabled={descSaving}
                      style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
                    >
                      Cancel
                    </button>
                    <span id={`desc-hint-${w.id}`} style={{ fontSize: 11, color: "var(--color-text-muted)" }}>⌘↵ to save · Esc to cancel</span>
                  </span>
                </span>
              ) : w.description ? (
                <p
                  title={w.description}
                  style={{
                    fontSize: 13, color: "var(--color-text-muted)", marginTop: 4, margin: "4px 0 0",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {w.description}
                </p>
              ) : null}
              {/* Tags row */}
              {editingTagsId === w.id ? (
                <span
                  style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitTags(w.id); }
                      if (e.key === "Escape") { e.preventDefault(); cancelEditTags(); }
                    }}
                    disabled={tagSaving}
                    placeholder="social, video, draft"
                    aria-label={`Edit tags for ${w.name}`}
                    aria-describedby={`tag-hint-${w.id}`}
                    style={{
                      padding: "3px 8px",
                      backgroundColor: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      color: "var(--color-text-primary)",
                      fontSize: 12,
                      outline: "none",
                      minWidth: 180,
                    }}
                  />
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitTags(w.id); }}
                    disabled={tagSaving}
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--color-accent)", background: "none", border: "none", cursor: tagSaving ? "default" : "pointer", padding: "2px 4px" }}
                  >
                    {tagSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelEditTags(); }}
                    disabled={tagSaving}
                    style={{ fontSize: 11, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
                  >
                    Cancel
                  </button>
                  <span id={`tag-hint-${w.id}`} style={{ fontSize: 11, color: "var(--color-text-muted)" }}>↵ to save · Esc to cancel</span>
                </span>
              ) : (w.tags ?? []).length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {(w.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTag(tag); }}
                      style={{
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 4,
                        backgroundColor: activeTag === tag ? "var(--color-accent)" : "var(--color-accent)18",
                        color: activeTag === tag ? "#fff" : "var(--color-accent)",
                        border: `1px solid ${activeTag === tag ? "var(--color-accent)" : "var(--color-accent)30"}`,
                        cursor: "pointer",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {/* Artifact-derived badge — shown when the current graph contains provenance-linked nodes */}
              {w.hasProvenanceNodes && (
                <div style={{ marginTop: 8 }}>
                  <span
                    title="This workflow contains nodes inserted from run artifacts"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 10, color: "#c4b5fd",
                      padding: "2px 7px", borderRadius: 4,
                      border: "1px solid rgba(167,139,250,0.25)",
                      backgroundColor: "rgba(88,28,135,0.20)",
                    }}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M6.5 4.5a2 2 0 00-2.83 0L1.5 6.67a2 2 0 002.83 2.83l.55-.55" />
                      <path d="M3.5 5.5a2 2 0 002.83 0l2.17-2.17a2 2 0 00-2.83-2.83l-.55.55" />
                    </svg>
                    artifact-derived
                  </span>
                </div>
              )}
              {w.revisionCount > 0 && (
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    {w.revisionCount} {w.revisionCount === 1 ? "checkpoint" : "checkpoints"}
                  </span>
                </div>
              )}
              <LastRunIndicator status={w.lastRunStatus} lastRunAt={w.lastRunAt} />
              {(w.lastRunStatus === "failed" || w.lastRunStatus === "partial_failure") && w.lastRunError && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "4px 6px",
                    borderRadius: 4,
                    border: "1px solid rgba(239,68,68,0.25)",
                    background: "rgba(127,29,29,0.25)",
                    fontSize: 10,
                    color: "#fca5a5",
                    lineHeight: 1.4,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                  title={w.lastRunError}
                >
                  {w.lastRunError}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                <p
                  style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}
                  title={new Date(w.updatedAt).toLocaleString()}
                >
                  Updated {formatTimeAgo(w.updatedAt)}
                </p>
                {deletingId === w.id ? (
                  <span
                    role="alertdialog"
                    aria-label={`Confirm deletion of ${w.name}`}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Delete?</span>
                    <button
                      ref={deleteConfirmYesRef}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(w.id); }}
                      aria-label={`Yes, delete ${w.name}`}
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--color-error)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeletingId(null); deleteTriggerRef.current?.focus(); }}
                      aria-label="No, cancel deletion"
                      style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/workflows/${w.id}/history`); }}
                      style={{ fontSize: 12, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
                    >
                      History
                    </button>
                    <span style={{ fontSize: 12, color: "var(--color-border)" }}>·</span>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRun(w.id); }}
                      disabled={!!runningId}
                      title={runningId === w.id ? "Run starting…" : "Run workflow"}
                      aria-keyshortcuts="X"
                      style={{ fontSize: 12, color: runningId === w.id ? "var(--color-text-muted)" : "var(--color-success, #4ade80)", background: "none", border: "none", cursor: runningId ? "default" : "pointer", padding: "2px 6px" }}
                    >
                      {runningId === w.id ? "Starting…" : "▶ Run  (X)"}
                    </button>
                    <span style={{ fontSize: 12, color: "var(--color-border)" }}>·</span>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTogglePin(w.id, w.isPinned); }}
                      disabled={pinningId === w.id}
                      aria-keyshortcuts="P"
                      style={{ fontSize: 12, color: w.isPinned ? "var(--color-accent)" : "var(--color-text-muted)", background: "none", border: "none", cursor: pinningId === w.id ? "default" : "pointer", padding: "2px 6px" }}
                    >
                      {pinningId === w.id ? "…" : w.isPinned ? "Unpin  (P)" : "Pin  (P)"}
                    </button>
                    <span style={{ fontSize: 12, color: "var(--color-border)" }}>·</span>
                    {/* Overflow menu */}
                    <span style={{ position: "relative" }}>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (openMenuId !== w.id) { menuTriggerRef.current = e.currentTarget; setOpenMenuId(w.id); } else { setOpenMenuId(null); } }}
                        style={{ fontSize: 15, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 8px", letterSpacing: 2, lineHeight: 1 }}
                        title="More actions"
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === w.id}
                        aria-controls={`menu-${w.id}`}
                      >
                        ···
                      </button>
                      {openMenuId === w.id && (
                        <div
                          ref={menuRef}
                          role="menu"
                          id={`menu-${w.id}`}
                          aria-label="Workflow actions"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
                            e.preventDefault();
                            e.stopPropagation();
                            const buttons = Array.from(
                              menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
                            );
                            if (buttons.length === 0) return;
                            const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
                            if (e.key === "Enter") {
                              buttons[idx]?.click();
                            } else if (e.key === "ArrowDown") {
                              (buttons[idx + 1] ?? buttons[0]).focus();
                            } else {
                              (buttons[idx - 1] ?? buttons[buttons.length - 1]).focus();
                            }
                          }}
                          style={{
                            position: "absolute", bottom: "calc(100% + 4px)", right: 0,
                            backgroundColor: "var(--color-bg-secondary)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 8, zIndex: 200,
                            minWidth: 150, boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                            overflow: "hidden",
                          }}
                        >
                          {(
                            [
                              [
                                { label: "Rename  (R)", action: () => { setOpenMenuId(null); startRename(w.id, w.name); }, keyshortcut: "R" },
                                { label: "Description", action: () => { setOpenMenuId(null); startEditDesc(w.id, w.description ?? ""); } },
                                { label: "Tags", action: () => { setOpenMenuId(null); startEditTags(w.id, w.tags ?? []); } },
                              ],
                              [
                                { label: duplicatingId === w.id ? "Copying…" : "Duplicate  (D)", action: () => { setOpenMenuId(null); handleDuplicate(w.id); }, disabled: duplicatingId === w.id, keyshortcut: "D" },
                                { label: exportingId === w.id ? "Exporting…" : "Export  (E)", action: () => { setOpenMenuId(null); handleExport(w.id, w.name); }, disabled: exportingId === w.id, keyshortcut: "E" },
                              ],
                              [
                                { label: savingTemplateId === w.id ? "Saving…" : "Save as Template", action: () => { setOpenMenuId(null); handleSaveAsTemplate(w.id); }, disabled: savingTemplateId === w.id },
                                { label: "Use Template", action: () => { setOpenMenuId(null); setStarterKey("template"); setSelectedTemplateId(templates[0]?.id ?? null); setShowModal(true); }, disabled: templates.length === 0 },
                              ],
                              [
                                { label: "Delete  (Del)", action: () => { deleteTriggerRef.current = menuTriggerRef.current; setOpenMenuId(null); setDeletingId(w.id); }, danger: true, keyshortcut: "Delete" },
                              ],
                            ] as { label: string; action: () => void; disabled?: boolean; danger?: boolean; keyshortcut?: string }[][]
                          ).map((group, gi) => (
                            <div key={gi}>
                              {gi > 0 && (
                                <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "4px 0" }} />
                              )}
                              {group.map(({ label, action, disabled, danger, keyshortcut }) => (
                                <button
                                  key={label}
                                  role="menuitem"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled) action(); }}
                                  disabled={disabled}
                                  aria-keyshortcuts={keyshortcut}
                                  onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = "var(--color-surface-hover)"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
                                  style={{
                                    display: "block", width: "100%", textAlign: "left",
                                    padding: "8px 14px", fontSize: 13,
                                    color: danger ? "var(--color-error)" : disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
                                    background: "none", border: "none",
                                    cursor: disabled ? "default" : "pointer",
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </span>
                  </span>
                )}
              </div>
              {activeWorkflowId === w.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  {([["C", copiedWorkflowId === w.id ? "Copied!" : "Copy ID"], ["↵", "Open"], ["X", "Run"]] as const).map(([key, label]) => (
                    <span key={key} style={{ display: "flex", gap: 3, alignItems: "center", fontSize: 10, color: "var(--color-text-muted)" }}>
                      <kbd style={{
                        fontFamily: "monospace",
                        fontSize: 9,
                        padding: "1px 4px",
                        borderRadius: 3,
                        border: "1px solid var(--color-border)",
                        backgroundColor: "var(--color-bg-primary)",
                        lineHeight: 1.5,
                        color: key === "C" && copiedWorkflowId === w.id ? "#4ade80" : "inherit",
                      }}>
                        {key}
                      </kbd>
                      <span style={{ color: key === "C" && copiedWorkflowId === w.id ? "#4ade80" : "inherit" }}>
                        {label}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
        </>
      )}

      {/* Create Workflow Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => { setShowModal(false); setCreateError(null); setStarterKey("blank"); setSelectedTemplateId(null); setRenamingTemplateId(null); }}
        >
          <div
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              padding: 24,
              width: 480,
              maxWidth: "90vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 20 }}>
              New Workflow
            </h2>
            {/* Starter template chooser */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
              {(
                [
                  { key: "blank", label: "Blank", icon: "◻", desc: "Empty canvas" },
                  { key: "image", label: "Image gen", icon: "🖼", desc: "Prompt → image → output" },
                  { key: "text", label: "Text", icon: "✏", desc: "Template → text output" },
                  { key: "quick-social-reel", label: "Social Reel", icon: "🎬", desc: "Prompt → image → video" },
                  { key: "product-promo", label: "Product Promo", icon: "📦", desc: "Best-of-N → social → export" },
                  { key: "story-highlight", label: "Story", icon: "🎞", desc: "Two-scene narrative" },
                ] as const
              ).map(({ key, label, icon, desc }) => (
                <button
                  key={key}
                  onClick={() => { setStarterKey(key); setSelectedTemplateId(null); }}
                  style={{
                    padding: "10px 8px",
                    backgroundColor: starterKey === key ? "rgba(var(--color-accent-rgb, 99,102,241),0.12)" : "var(--color-surface)",
                    border: starterKey === key ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border)",
                    borderRadius: 8,
                    color: starterKey === key ? "var(--color-accent)" : "var(--color-text-secondary)",
                    fontSize: 12,
                    fontWeight: starterKey === key ? 600 : 400,
                    cursor: "pointer",
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{desc}</div>
                </button>
              ))}
            </div>
            {/* Saved templates section */}
            {templates.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Saved Templates
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                  {templates.map((t) => {
                    const isRenaming = renamingTemplateId === t.id;
                    const isSelected = selectedTemplateId === t.id;
                    return (
                      <div
                        key={t.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 10px",
                          backgroundColor: isSelected ? "rgba(var(--color-accent-rgb, 99,102,241),0.10)" : "var(--color-surface)",
                          border: isSelected ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border)",
                          borderRadius: 7, cursor: isRenaming ? "default" : "pointer",
                        }}
                        onClick={() => { if (!isRenaming) { setSelectedTemplateId(t.id); setStarterKey("template"); } }}
                      >
                        <span style={{ fontSize: 14, flexShrink: 0 }}>📄</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {isRenaming ? (
                            <input
                              value={templateRenameInput}
                              onChange={(e) => setTemplateRenameInput(e.target.value)}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameTemplate(t.id);
                                if (e.key === "Escape") setRenamingTemplateId(null);
                              }}
                              style={{
                                width: "100%", padding: "2px 6px", fontSize: 13,
                                backgroundColor: "var(--color-bg-secondary)",
                                border: "1px solid var(--color-accent)",
                                borderRadius: 4, color: "var(--color-text-primary)",
                                outline: "none",
                              }}
                            />
                          ) : (
                            <>
                              <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400, color: isSelected ? "var(--color-accent)" : "var(--color-text-primary)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {t.name}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {templateGraphPreview(t.graph)}
                              </span>
                            </>
                          )}
                        </span>
                        {isRenaming ? (
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRenameTemplate(t.id); }}
                              disabled={templateRenameSaving}
                              style={{ background: "none", border: "none", color: "var(--color-accent)", cursor: "pointer", fontSize: 11, padding: "0 2px", fontWeight: 600 }}
                            >
                              {templateRenameSaving ? "…" : "Save"}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setRenamingTemplateId(null); }}
                              style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setRenamingTemplateId(t.id); setTemplateRenameInput(t.name); }}
                              title="Rename template"
                              style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: 12, padding: "0 3px", lineHeight: 1 }}
                            >
                              ✎
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }}
                              title="Remove template"
                              style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {createError && (
              <div style={{
                marginBottom: 16, padding: "10px 14px", borderRadius: 8,
                backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                fontSize: 13, color: "var(--color-error)",
              }}>
                {createError}
              </div>
            )}
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
                Name
              </span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My workflow"
                autoFocus
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  color: "var(--color-text-primary)",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) handleCreate();
                }}
              />
            </label>
            <label style={{ display: "block", marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
                Description (optional)
              </span>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What does this workflow do?"
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  color: "var(--color-text-primary)",
                  fontSize: 14,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => { setShowModal(false); setCreateError(null); setStarterKey("blank"); setSelectedTemplateId(null); setRenamingTemplateId(null); }}
                style={{
                  padding: "9px 18px",
                  backgroundColor: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  color: "var(--color-text-secondary)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                style={{
                  padding: "9px 18px",
                  backgroundColor: newName.trim() ? "var(--color-accent)" : "var(--color-surface)",
                  border: "none",
                  borderRadius: 8,
                  color: newName.trim() ? "#fff" : "var(--color-text-muted)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: newName.trim() ? "pointer" : "default",
                }}
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Last-run dot + label ───────────────────────────────────────────────────

const RUN_DOT_COLOR: Record<string, string> = {
  completed:       "#4ade80",
  running:         "#60a5fa",
  failed:          "#f87171",
  partial_failure: "#f87171",
  cancelled:       "#737373",
  budget_exceeded: "#facc15",
  pending:         "#facc15",
};

function templateGraphPreview(graph: WorkflowTemplate["graph"]): string {
  const nodes = graph?.nodes ?? [];
  if (nodes.length === 0) return "Empty graph";
  const chain = nodes.map((n) => n.type).join(" → ");
  return `${nodes.length} node${nodes.length !== 1 ? "s" : ""} · ${chain}`;
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function LastRunIndicator({
  status,
  lastRunAt,
}: {
  status: string | null;
  lastRunAt: string | null;
}) {
  const dotColor = status ? (RUN_DOT_COLOR[status] ?? "#737373") : undefined;
  const label    = status ? status.replace("_", " ") : null;
  const time     = lastRunAt ? formatTimeAgo(lastRunAt) : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
      {dotColor ? (
        <>
          <span style={{
            display: "inline-block", width: 7, height: 7,
            borderRadius: "50%", backgroundColor: dotColor, flexShrink: 0,
            ...(status === "running" && {
              animation: "run-pulse 1.2s ease-in-out infinite",
            }),
          }} />
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", textTransform: "capitalize" }}>
            {label}
          </span>
          {time && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>· {time}</span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No runs yet</span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    completed: "var(--color-success)",
    running: "var(--color-accent)",
    failed: "var(--color-error)",
    pending: "var(--color-warning)",
  };
  const color = colorMap[status] || "var(--color-text-muted)";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: 6,
        backgroundColor: color + "20",
        color,
        textTransform: "capitalize",
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}
