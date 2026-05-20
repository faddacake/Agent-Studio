"use client";

import { useEffect, useState } from "react";
import type { EditorProject } from "@/lib/editorProjectTypes";
import { EditorProjectsList } from "@/components/editor/EditorProjectsList";
import { NewEditorProjectCard } from "@/components/editor/NewEditorProjectCard";

export default function VideoProjectsPage() {
  const [projects, setProjects] = useState<EditorProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    fetch("/api/editor-projects")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<EditorProject[]>;
      })
      .then(setProjects)
      .catch(() => {/* leave list empty on error */})
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(project: EditorProject) {
    setProjects((prev) => [project, ...prev]);
    setShowNewForm(false);
  }

  function handleRenamed(id: string, name: string) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function handleDeleted(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-neutral-950">

      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
          height: 52,
          borderBottom: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: "var(--color-text-primary)",
          }}
        >
          Video Projects
        </h1>

        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid var(--color-accent)",
            backgroundColor: showNewForm ? "var(--color-accent)" : "transparent",
            color: showNewForm ? "#fff" : "var(--color-accent)",
            cursor: "pointer",
            transition: "background-color 120ms, color 120ms",
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          New Video Project
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          maxWidth: 960,
          width: "100%",
          margin: "0 auto",
          padding: "28px 28px 48px",
          boxSizing: "border-box",
        }}
      >
        {/* New project form — shown when button is toggled */}
        {showNewForm && (
          <div style={{ marginBottom: 32, maxWidth: 420 }}>
            <NewEditorProjectCard onCreated={handleCreated} />
          </div>
        )}

        {/* Project count label */}
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
          }}
        >
          {loading
            ? "Loading…"
            : projects.length === 0
            ? "No projects yet"
            : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
        </p>

        {/* Project grid — only rendered when there are projects */}
        {!loading && projects.length > 0 && (
          <EditorProjectsList
            projects={projects}
            onRename={handleRenamed}
            onDelete={handleDeleted}
          />
        )}

        {/* Empty state */}
        {!loading && projects.length === 0 && !showNewForm && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 8 }}>
            Click <strong style={{ color: "var(--color-text-secondary)" }}>+ New Video Project</strong> to get started.
          </p>
        )}
      </div>
    </div>
  );
}
