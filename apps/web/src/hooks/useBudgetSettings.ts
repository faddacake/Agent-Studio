"use client";

/**
 * useBudgetSettings — read/write the per-session soft budget cap.
 *
 * Stored in localStorage so it persists across page refreshes but is not
 * sent to the server unless explicitly passed to runWorkflow / triggerExport.
 *
 * Default: $2.00 per run.
 *
 * Multiple instances of this hook (e.g. WorkflowCanvas toolbar and
 * BudgetSettingsPanel) stay in sync via a same-tab custom DOM event.
 * Cross-tab sync falls back to the "storage" event automatically.
 */

import { useState, useCallback, useEffect } from "react";

export const BUDGET_CAP_STORAGE_KEY = "aistudio_budget_cap_usd";
export const DEFAULT_BUDGET_CAP = 2.0;

/** Custom event name used to broadcast cap changes within the same tab. */
const BUDGET_CHANGE_EVENT = "aistudio:budget-cap-changed";

/** Read the current budget cap from localStorage (safe to call in any context). */
export function readBudgetCapFromStorage(): number {
  if (typeof window === "undefined") return DEFAULT_BUDGET_CAP;
  const stored = localStorage.getItem(BUDGET_CAP_STORAGE_KEY);
  if (!stored) return DEFAULT_BUDGET_CAP;
  const parsed = parseFloat(stored);
  return parsed > 0 ? parsed : DEFAULT_BUDGET_CAP;
}

/** Write a budget cap to localStorage and notify all hook instances in this tab. */
export function writeBudgetCapToStorage(cap: number): void {
  if (typeof window === "undefined") return;
  const valid = cap > 0 ? cap : DEFAULT_BUDGET_CAP;
  try {
    localStorage.setItem(BUDGET_CAP_STORAGE_KEY, String(valid));
    // Notify all useBudgetSettings instances in the same tab.
    window.dispatchEvent(
      new CustomEvent<number>(BUDGET_CHANGE_EVENT, { detail: valid }),
    );
  } catch {
    // Storage quota exceeded or private-browsing mode — silently ignore.
  }
}

export interface BudgetSettings {
  /** Current budget cap in USD (always > 0). */
  budgetCap: number;
  /** Update the cap and persist it to localStorage. */
  setBudgetCap: (cap: number) => void;
}

export function useBudgetSettings(): BudgetSettings {
  const [budgetCap, setBudgetCapState] = useState<number>(() =>
    readBudgetCapFromStorage(),
  );

  // Keep this instance in sync when another instance writes a new cap.
  useEffect(() => {
    function onBudgetChange(e: Event) {
      setBudgetCapState((e as CustomEvent<number>).detail);
    }
    function onStorageChange(e: StorageEvent) {
      // Cross-tab sync: browser fires "storage" events for other tabs.
      if (e.key === BUDGET_CAP_STORAGE_KEY && e.newValue !== null) {
        const parsed = parseFloat(e.newValue);
        if (parsed > 0) setBudgetCapState(parsed);
      }
    }
    window.addEventListener(BUDGET_CHANGE_EVENT, onBudgetChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      window.removeEventListener(BUDGET_CHANGE_EVENT, onBudgetChange);
      window.removeEventListener("storage", onStorageChange);
    };
  }, []);

  const setBudgetCap = useCallback((cap: number) => {
    const valid = cap > 0 ? cap : DEFAULT_BUDGET_CAP;
    setBudgetCapState(valid);
    writeBudgetCapToStorage(valid);
  }, []);

  return { budgetCap, setBudgetCap };
}
