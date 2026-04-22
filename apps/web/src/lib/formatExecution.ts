/** Format a duration in milliseconds into a human-readable string. */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** Format a USD cost value with appropriate decimal precision. */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format an elapsed time in seconds into a human-readable string. */
export function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ── Error humanization ────────────────────────────────────────────────────────

export interface HumanizedError {
  /** Short, user-friendly message (no raw stack traces). */
  message: string;
  /** Contextual suggestion for recovering from the error. */
  suggestion?: string;
}

/**
 * Convert a raw node execution error string into a user-friendly message
 * and an optional recovery suggestion.
 *
 * Covers the most common failure categories: auth, rate-limits, timeouts,
 * budget overruns, validation, and generic provider/network failures.
 */
export function humanizeNodeError(raw: string | undefined): HumanizedError {
  if (!raw) return { message: "Unknown error" };
  const s = raw.toLowerCase();

  if (s.includes("not configured") || (s.includes("api key") && !s.includes("invalid"))) {
    return {
      message: "Provider not configured",
      suggestion: "Add your API key in Settings → Providers",
    };
  }
  if (s.includes("invalid") && (s.includes("api key") || s.includes("key"))) {
    return {
      message: "Invalid API key",
      suggestion: "Check your key in Settings → Providers",
    };
  }
  if (s.includes("rate limit") || s.includes("429") || s.includes("too many requests")) {
    return {
      message: "Rate limit reached",
      suggestion: "Wait a moment then retry",
    };
  }
  if (
    s.includes("401") ||
    s.includes("403") ||
    s.includes("unauthorized") ||
    s.includes("forbidden")
  ) {
    return {
      message: "Authentication failed",
      suggestion: "Check your API key in Settings → Providers",
    };
  }
  if (s.includes("timeout") || s.includes("timed out") || s.includes("econnreset")) {
    return {
      message: "Request timed out",
      suggestion: "Retry or switch to a faster model",
    };
  }
  if (s.includes("budget") || s.includes("cap exceeded")) {
    return {
      message: "Budget cap reached",
      suggestion: "Increase your budget cap or use cheaper models",
    };
  }
  if (s.includes("validation failed") || s.includes("required field")) {
    return {
      message: "Validation error",
      suggestion: "Check the node's parameter configuration",
    };
  }
  if (
    s.includes("econnrefused") ||
    s.includes("network") ||
    s.includes("failed to fetch")
  ) {
    return {
      message: "Network error",
      suggestion: "Check your connection and retry",
    };
  }
  if (s.includes("500") || s.includes("502") || s.includes("503")) {
    return {
      message: "Provider server error",
      suggestion: "Retry in a moment — the provider may be temporarily down",
    };
  }

  // Fallback: truncate raw message so it fits in the UI.
  const msg = raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  return { message: msg };
}
