"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  check: () => Promise<boolean>;
}

const CHECKLIST: ChecklistItem[] = [
  {
    id: "password",
    title: "Set your password",
    description: "You've already done this — you're logged in!",
    href: "/settings",
    linkLabel: "Settings",
    check: async () => true, // If they're here, they've set a password
  },
  {
    id: "provider",
    title: "Connect an AI provider",
    description: "Add an API key for Replicate, Fal, or another provider to start generating content.",
    href: "/settings/providers",
    linkLabel: "Add Provider",
    check: async () => {
      try {
        const res = await fetch("/api/providers");
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    id: "workflow",
    title: "Create your first workflow",
    description: "Build a pipeline with the visual canvas editor, or try the One-Prompt runner for quick comparisons.",
    href: "/workflows",
    linkLabel: "New Workflow",
    check: async () => {
      try {
        const res = await fetch("/api/workflows");
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    id: "prompt",
    title: "Try the One-Prompt runner",
    description: "Type a single prompt, select models, and compare results side-by-side — the fastest way to start.",
    href: "/prompt",
    linkLabel: "Open Prompt",
    check: async () => false, // Manual — no auto-check
  },
];

export default function GettingStartedPage() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all(
      CHECKLIST.map(async (item) => {
        const done = await item.check();
        return [item.id, done] as const;
      }),
    ).then((results) => {
      setCompleted(Object.fromEntries(results));
      setLoaded(true);
    });
  }, []);

  const doneCount = Object.values(completed).filter(Boolean).length;

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>
        Getting Started
      </h1>
      <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 32 }}>
        Complete these steps to start generating content with Agent Studio.
      </p>

      {/* Progress bar */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
            Progress
          </span>
          <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            {loaded ? `${doneCount}/${CHECKLIST.length}` : "..."}
          </span>
        </div>
        <div
          style={{
            height: 6,
            backgroundColor: "var(--color-surface)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: loaded ? `${(doneCount / CHECKLIST.length) * 100}%` : "0%",
              backgroundColor: "var(--color-accent)",
              borderRadius: 3,
              transition: "width 300ms ease",
            }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {CHECKLIST.map((item) => {
          const done = completed[item.id] ?? false;
          return (
            <div
              key={item.id}
              style={{
                padding: 20,
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                opacity: done ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: done ? "none" : "2px solid var(--color-border)",
                    backgroundColor: done ? "var(--color-success)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {done && (
                    <svg width={12} height={12} viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5L6.5 12L13 4" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4, textDecoration: done ? "line-through" : "none" }}>
                    {item.title}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5, marginBottom: done ? 0 : 10 }}>
                    {item.description}
                  </p>
                  {!done && (
                    <Link
                      href={item.href}
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--color-accent)",
                        textDecoration: "none",
                      }}
                    >
                      {item.linkLabel} &rarr;
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
