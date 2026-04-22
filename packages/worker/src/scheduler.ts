/**
 * scheduler.ts — lightweight cron runner for AI Studio workflow schedules.
 *
 * On startup, aligns to the next minute boundary then ticks every 60 seconds.
 * Each tick reads all `workflow_schedule:*` rows from the settings table,
 * evaluates the cron expression against the current time, and POSTs to
 * /api/workflows/:id/runs for each enabled, matching schedule.
 *
 * Dependency-free: no cron library needed.  Supports *, *\/N, and exact-number
 * fields — enough for all built-in presets and the vast majority of user inputs.
 *
 * Environment variables:
 *   API_BASE_URL          Base URL of the Next.js server (default: http://localhost:3000)
 *   SCHEDULER_BUDGET_CAP  Budget cap passed to each triggered run in USD (default: 2.0)
 */

import { getDb, schema } from "@aistudio/db";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleRecord {
  cron: string;
  enabled: boolean;
  updatedAt: string;
}

// ── Minimal cron field parser ─────────────────────────────────────────────────

/**
 * Matches a single cron field against a concrete integer value.
 *
 *   *      → always true
 *   *\/N   → true when value % N === 0 (step)
 *   N      → true when value === N (exact)
 *
 * Comma-lists and ranges (1-5, 1,3,5) are not supported in V1 — they are
 * rare in the preset set and trivial to add later if needed.
 */
function matchField(field: string, value: number): boolean {
  if (field === "*") return true;

  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }

  const n = parseInt(field, 10);
  return Number.isFinite(n) && value === n;
}

/**
 * Returns true if the 5-field cron expression `expr` matches `now`.
 *
 * Field order: minute · hour · day-of-month · month · day-of-week
 * Month is 1-indexed (cron convention). Day-of-week: 0 = Sunday (matches JS).
 */
function matchesCron(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  return (
    matchField(min,   now.getMinutes())   &&
    matchField(hour,  now.getHours())     &&
    matchField(dom,   now.getDate())      &&
    matchField(month, now.getMonth() + 1) && // getMonth() is 0-indexed; cron is 1-indexed
    matchField(dow,   now.getDay())          // both 0 = Sunday
  );
}

// ── Run trigger ───────────────────────────────────────────────────────────────

const _rawCap = parseFloat(process.env.SCHEDULER_BUDGET_CAP ?? "");
const BUDGET_CAP = Number.isFinite(_rawCap) && _rawCap > 0 ? _rawCap : 2.0;

async function triggerRun(apiBaseUrl: string, workflowId: string): Promise<void> {
  const url = `${apiBaseUrl}/api/workflows/${workflowId}/runs`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetCap: BUDGET_CAP }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { id?: string };
  console.log(`[scheduler] ✓ Run ${data.id ?? "?"} started for workflow ${workflowId}`);
}

// ── Tick ──────────────────────────────────────────────────────────────────────

async function checkSchedules(apiBaseUrl: string): Promise<void> {
  const now = new Date();

  // Read all settings rows and filter for schedule keys in JS.
  // The settings table is small; a full scan is fine.
  let allRows: Array<{ key: string; value: string }>;
  try {
    allRows = getDb().select().from(schema.settings).all();
  } catch (err) {
    console.error("[scheduler] DB read failed:", (err as Error).message);
    return;
  }

  const PREFIX = "workflow_schedule:";
  const scheduleRows = allRows.filter((r) => r.key.startsWith(PREFIX));

  for (const row of scheduleRows) {
    let record: ScheduleRecord;
    try {
      record = JSON.parse(row.value) as ScheduleRecord;
    } catch {
      console.warn(`[scheduler] Skipping malformed schedule key: ${row.key}`);
      continue;
    }

    if (!record.enabled) continue;
    if (!matchesCron(record.cron, now)) continue;

    const workflowId = row.key.slice(PREFIX.length);
    console.log(`[scheduler] Firing schedule for workflow ${workflowId} (cron: "${record.cron}")`);

    // Fire-and-forget — don't block the tick loop on slow runs.
    triggerRun(apiBaseUrl, workflowId).catch((err: Error) => {
      console.error(`[scheduler] Failed to trigger workflow ${workflowId}:`, err.message);
    });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

/**
 * Starts the cron scheduler.
 *
 * Aligns the first tick to the top of the next wall-clock minute so that
 * expressions like "0 9 * * *" fire at exactly 09:00 regardless of when the
 * process started.  Subsequent ticks run every 60 seconds from that point.
 */
export function startScheduler(
  apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000",
): void {
  const msToNextMinute = 60_000 - (Date.now() % 60_000);

  console.log(
    `[scheduler] Initialized — first tick in ${Math.round(msToNextMinute / 1000)}s, ` +
    `then every 60s. API base: ${apiBaseUrl}`,
  );

  setTimeout(() => {
    // First tick at the minute boundary
    void checkSchedules(apiBaseUrl);
    // Subsequent ticks every 60 s
    setInterval(() => { void checkSchedules(apiBaseUrl); }, 60_000);
  }, msToNextMinute);
}
