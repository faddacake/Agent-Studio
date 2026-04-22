"use client";

/**
 * BudgetWarningModal — shown before a workflow run when the estimated cost
 * exceeds the user's configured budget cap.
 *
 * Three actions:
 *  1. "Set budget to $X and run" — doubles the estimate, persists, then runs.
 *  2. "Proceed anyway"           — runs with the existing cap (engine hard-stops at cap).
 *  3. "Cancel"                   — dismisses without running.
 *
 * Accessible: traps focus on the Cancel button (least-destructive action),
 * closes on Escape, and uses role="dialog" + aria-modal.
 */

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { formatCost } from "@/lib/formatExecution";

interface BudgetWarningModalProps {
  estimatedCost: number;
  budgetCap: number;
  onProceed: () => void;
  onCancel: () => void;
  /** Called with a suggested new cap; parent should persist + proceed with new cap. */
  onIncreaseBudget: (newCap: number) => void;
}

// ── Inline styles (consistent with ExportStatusPanel's approach) ──────────────

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9000,
};

const panelStyle: CSSProperties = {
  backgroundColor: "var(--color-bg-secondary, #18181b)",
  border: "1px solid var(--color-border, #3f3f46)",
  borderRadius: 10,
  padding: "24px 24px 20px",
  maxWidth: 380,
  width: "90%",
  boxShadow: "0 20px 48px rgba(0,0,0,0.55)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 12,
  marginBottom: 4,
};

function Btn({
  onClick,
  primary,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        fontSize: 12,
        fontWeight: primary ? 600 : 500,
        padding: "8px 14px",
        borderRadius: 6,
        border: primary
          ? "1px solid var(--color-accent, #6366f1)"
          : "1px solid var(--color-border, #3f3f46)",
        backgroundColor: primary ? "var(--color-accent, #6366f1)" : "transparent",
        color: primary ? "#fff" : "var(--color-text-muted, #71717a)",
        cursor: "pointer",
        textAlign: "center",
      }}
    >
      {children}
    </button>
  );
}

export function BudgetWarningModal({
  estimatedCost,
  budgetCap,
  onProceed,
  onCancel,
  onIncreaseBudget,
}: BudgetWarningModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus cancel on mount; close on Escape.
  useEffect(() => {
    cancelRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  // Suggest a cap that gives ~2× headroom, rounded up to the nearest cent.
  const suggestedCap = Math.ceil(estimatedCost * 2 * 100) / 100;

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bwm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={panelStyle}>
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 16, color: "var(--color-warning, #f59e0b)" }} aria-hidden="true">
            ⚠
          </span>
          <h2
            id="bwm-title"
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text-primary, #f4f4f5)",
            }}
          >
            Estimated cost exceeds budget
          </h2>
        </div>

        {/* Cost breakdown */}
        <div
          style={{
            borderRadius: 6,
            border: "1px solid var(--color-border, #3f3f46)",
            padding: "10px 12px",
            marginBottom: 14,
          }}
        >
          <div style={rowStyle}>
            <span style={{ color: "var(--color-text-muted, #71717a)" }}>Estimated cost</span>
            <span style={{ color: "var(--color-warning, #f59e0b)", fontWeight: 600 }}>
              {formatCost(estimatedCost)}
            </span>
          </div>
          <div style={{ ...rowStyle, marginBottom: 0 }}>
            <span style={{ color: "var(--color-text-muted, #71717a)" }}>Budget cap</span>
            <span style={{ color: "var(--color-text-secondary, #a1a1aa)" }}>
              {formatCost(budgetCap)}
            </span>
          </div>
        </div>

        {/* Explanation */}
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-muted, #71717a)",
            lineHeight: 1.55,
            margin: "0 0 18px",
          }}
        >
          The engine will hard-stop when costs reach the budget cap. Consider switching to a
          cheaper model or increasing your cap before running.
        </p>

        {/* Actions (stacked, most-prominent first) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn primary onClick={() => onIncreaseBudget(suggestedCap)}>
            Set budget to {formatCost(suggestedCap)} and run
          </Btn>
          <Btn onClick={onProceed}>
            Proceed anyway — hard stop at {formatCost(budgetCap)}
          </Btn>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              width: "100%",
              fontSize: 12,
              fontWeight: 500,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--color-border, #3f3f46)",
              backgroundColor: "transparent",
              color: "var(--color-text-muted, #71717a)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
