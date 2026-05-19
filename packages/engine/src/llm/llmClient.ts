/**
 * Common interface for all LLM text-generation adapters.
 *
 * Keeps the ReAct loop provider-agnostic: swap the client, the loop is unchanged.
 */

// ── Error categorisation ───────────────────────────────────────────────────────

/**
 * Structured error kinds so callers can react (pun intended) differently:
 *
 *   rate_limit     → back off and retry after a delay
 *   context_length → truncate history and retry
 *   auth           → surface "invalid API key" to the user; no point retrying
 *   server         → transient provider outage; may be worth a single retry
 *   network        → fetch() threw (DNS, TLS, timeout); may retry
 *   unknown        → catch-all; inspect `message` for details
 */
export type LLMErrorKind =
  | "rate_limit"
  | "context_length"
  | "auth"
  | "server"
  | "network"
  | "unknown";

export class LLMError extends Error {
  readonly name = "LLMError";

  constructor(
    message: string,
    /** Structured category for programmatic handling */
    public readonly kind: LLMErrorKind,
    /** HTTP status code when available */
    public readonly statusCode?: number,
  ) {
    super(message);
  }
}

/** True when the error is safe to surface directly to the end user. */
export function isUserFacingLLMError(err: LLMError): boolean {
  return err.kind === "auth" || err.kind === "context_length";
}

// ── Message + options ──────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  /** Max output tokens (default: 1024) */
  maxTokens?: number;
  /**
   * Sampling temperature 0–2.
   * 0 = deterministic greedy, 1 = default, >1 = more creative.
   * Clamped to provider-specific ranges by each adapter.
   */
  temperature?: number;
  /**
   * Stop sequences — generation halts when any of these strings is produced.
   * Up to 4 sequences (providers may accept fewer).
   */
  stop?: string[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ── Client interface ───────────────────────────────────────────────────────────

export interface LLMTextClient {
  /**
   * Send a chat conversation and return the assistant's reply as a string.
   *
   * @throws {LLMError} on API errors — check `.kind` to decide whether to retry
   *                    or surface the message to the user.
   */
  chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string>;
}
