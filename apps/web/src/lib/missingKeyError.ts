/**
 * Returns true when an error message indicates that the failure was caused
 * by a missing or unconfigured provider API key.
 *
 * Used by canvas node components (CustomNode, AgentNode, SubAgentNode) to
 * surface an actionable "⚠ No API Key" badge instead of a raw error string.
 *
 * Matches the message emitted by runs/route.ts:
 *   Provider "fal" is not configured. Add your API key in Settings → Providers…
 */
export function isMissingKeyError(error: string | null | undefined): boolean {
  if (!error) return false;
  return (
    /Provider "[^"]+" is not configured/i.test(error) ||
    (/not configured/i.test(error) && /api[\s-]?key/i.test(error))
  );
}

/**
 * Returns true when an error indicates a vault path / filesystem configuration
 * problem in an Obsidian Memory node.
 *
 * Covers the common failure modes:
 *   - ENOENT  — vault directory does not exist
 *   - EACCES  — process lacks read/write permission on the path
 *   - Generic "vault" or "vaultPath" mentions in error messages from the executor
 */
export function isVaultConfigError(error: string | null | undefined): boolean {
  if (!error) return false;
  return (
    /ENOENT/i.test(error) ||
    /EACCES/i.test(error) ||
    /no such file or directory/i.test(error) ||
    /permission denied/i.test(error) ||
    /vault\s*path/i.test(error) ||
    /vaultPath/i.test(error)
  );
}
