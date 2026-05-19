/**
 * Common interface for all LLM text-generation adapters.
 *
 * Keeps the ReAct loop provider-agnostic: swap the client, the loop is unchanged.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  /** Max tokens for the response (default: 1024) */
  maxTokens?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface LLMTextClient {
  /**
   * Send a chat conversation and return the assistant's reply as a string.
   * Throws on API errors, rate limits, or invalid keys.
   */
  chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string>;
}
