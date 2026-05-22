import { RunCoordinator } from "@iterastudio/engine";

// Use globalThis so the coordinator survives Next.js HMR module reloads in dev
// mode. Without this, each hot-reload resets the module-level variable, making
// the run invisible to the SSE events route → 404 → "SSE connection error".
const g = globalThis as typeof globalThis & { __runCoordinator?: RunCoordinator };

/** Get the singleton RunCoordinator instance (server-side only). */
export function getRunCoordinator(): RunCoordinator {
  if (!g.__runCoordinator) {
    g.__runCoordinator = new RunCoordinator();
  }
  return g.__runCoordinator;
}
