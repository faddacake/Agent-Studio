/**
 * Unit tests for isMissingKeyError and isVaultConfigError.
 *
 * Both helpers are pure functions that classify error message strings.
 * Tests cover: true positives, true negatives, edge inputs, and
 * cross-contamination (a vault error shouldn't match the key detector
 * and vice versa).
 *
 * Run with: pnpm --filter @aistudio/web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isMissingKeyError, isVaultConfigError } from "./missingKeyError";

// ── isMissingKeyError ─────────────────────────────────────────────────────────

describe("isMissingKeyError — falsy / empty inputs", () => {
  it("returns false for null", () => assert.equal(isMissingKeyError(null), false));
  it("returns false for undefined", () => assert.equal(isMissingKeyError(undefined), false));
  it("returns false for empty string", () => assert.equal(isMissingKeyError(""), false));
});

describe("isMissingKeyError — primary pattern: Provider \"x\" is not configured", () => {
  it("matches the canonical message emitted by runs/route.ts", () => {
    assert.equal(
      isMissingKeyError('Provider "fal" is not configured. Add your API key in Settings → Providers…'),
      true,
    );
  });

  it("matches with a different provider name", () => {
    assert.equal(isMissingKeyError('Provider "openai" is not configured'), true);
  });

  it("matches with a hyphenated provider name", () => {
    assert.equal(isMissingKeyError('Provider "stable-diffusion" is not configured'), true);
  });

  it("is case-insensitive on 'provider'", () => {
    assert.equal(isMissingKeyError('PROVIDER "fal" is not configured'), true);
  });

  it("is case-insensitive on 'not configured'", () => {
    assert.equal(isMissingKeyError('Provider "fal" IS NOT CONFIGURED'), true);
  });
});

describe("isMissingKeyError — secondary pattern: not configured + api key", () => {
  it("matches 'not configured' + 'api key' (spaced)", () => {
    assert.equal(isMissingKeyError("Service not configured — please provide your api key"), true);
  });

  it("matches 'not configured' + 'api-key' (hyphenated)", () => {
    assert.equal(isMissingKeyError("not configured: missing api-key"), true);
  });

  it("matches 'not configured' + 'apikey' (no separator)", () => {
    assert.equal(isMissingKeyError("not configured, apikey required"), true);
  });

  it("requires BOTH 'not configured' AND 'api key' for secondary match", () => {
    // only "not configured" alone should not match
    assert.equal(isMissingKeyError("Service is not configured"), false);
  });

  it("requires BOTH 'not configured' AND 'api key' — api key alone does not match", () => {
    assert.equal(isMissingKeyError("please provide your api key"), false);
  });
});

describe("isMissingKeyError — unrelated errors should not match", () => {
  it("returns false for a network timeout error", () => {
    assert.equal(isMissingKeyError("Network timeout after 30s"), false);
  });

  it("returns false for a generic runtime error", () => {
    assert.equal(isMissingKeyError("TypeError: Cannot read properties of undefined"), false);
  });

  it("returns false for a vault path error (ENOENT)", () => {
    assert.equal(isMissingKeyError("ENOENT: no such file or directory '/app/memory/note.md'"), false);
  });

  it("returns false for a permission denied error (EACCES)", () => {
    assert.equal(isMissingKeyError("EACCES: permission denied, open '/app/memory'"), false);
  });

  it("returns false for a generic execution failure", () => {
    assert.equal(isMissingKeyError("Node failed to produce output"), false);
  });

  it("returns false for an out-of-credits message (no configuration language)", () => {
    assert.equal(isMissingKeyError("You have exceeded your quota"), false);
  });
});

// ── isVaultConfigError ────────────────────────────────────────────────────────

describe("isVaultConfigError — falsy / empty inputs", () => {
  it("returns false for null", () => assert.equal(isVaultConfigError(null), false));
  it("returns false for undefined", () => assert.equal(isVaultConfigError(undefined), false));
  it("returns false for empty string", () => assert.equal(isVaultConfigError(""), false));
});

describe("isVaultConfigError — ENOENT matches", () => {
  it("matches Node.js ENOENT prefix", () => {
    assert.equal(isVaultConfigError("ENOENT: no such file or directory, open '/app/memory/notes.md'"), true);
  });

  it("matches bare ENOENT code", () => {
    assert.equal(isVaultConfigError("ENOENT"), true);
  });

  it("is case-insensitive for ENOENT", () => {
    assert.equal(isVaultConfigError("enoent: path not found"), true);
  });
});

describe("isVaultConfigError — EACCES matches", () => {
  it("matches Node.js EACCES prefix", () => {
    assert.equal(isVaultConfigError("EACCES: permission denied, open '/app/memory'"), true);
  });

  it("matches bare EACCES code", () => {
    assert.equal(isVaultConfigError("EACCES"), true);
  });

  it("is case-insensitive for EACCES", () => {
    assert.equal(isVaultConfigError("eacces: access denied"), true);
  });
});

describe("isVaultConfigError — 'no such file or directory' phrase", () => {
  it("matches the full phrase", () => {
    assert.equal(isVaultConfigError("no such file or directory"), true);
  });

  it("matches when embedded in a longer message", () => {
    assert.equal(
      isVaultConfigError("open '/vault/notes/todo.md': no such file or directory"),
      true,
    );
  });

  it("is case-insensitive", () => {
    assert.equal(isVaultConfigError("No Such File Or Directory"), true);
  });
});

describe("isVaultConfigError — 'permission denied' phrase", () => {
  it("matches the phrase without EACCES code", () => {
    assert.equal(isVaultConfigError("permission denied reading vault"), true);
  });

  it("matches when embedded in longer message", () => {
    assert.equal(isVaultConfigError("Error: permission denied writing to /app/memory/note.md"), true);
  });

  it("is case-insensitive", () => {
    assert.equal(isVaultConfigError("Permission Denied"), true);
  });
});

describe("isVaultConfigError — vault path mentions", () => {
  it("matches 'vault path' (spaced)", () => {
    assert.equal(isVaultConfigError("Invalid vault path supplied"), true);
  });

  it("matches 'vaultPath' (camelCase)", () => {
    assert.equal(isVaultConfigError("vaultPath does not exist"), true);
  });

  it("matches 'vault  path' with extra whitespace", () => {
    assert.equal(isVaultConfigError("vault  path is unreachable"), true);
  });

  it("is case-insensitive for vault path", () => {
    assert.equal(isVaultConfigError("Vault Path configuration error"), true);
  });
});

describe("isVaultConfigError — unrelated errors should not match", () => {
  it("returns false for a missing API key error", () => {
    assert.equal(
      isVaultConfigError('Provider "fal" is not configured. Add your API key in Settings → Providers…'),
      false,
    );
  });

  it("returns false for a network timeout", () => {
    assert.equal(isVaultConfigError("Network timeout after 30s"), false);
  });

  it("returns false for a generic runtime error", () => {
    assert.equal(isVaultConfigError("TypeError: Cannot read properties of undefined"), false);
  });

  it("returns false for a generic execution failure message", () => {
    assert.equal(isVaultConfigError("Memory node failed to return results"), false);
  });

  it("returns false for a search with zero results (not an error)", () => {
    assert.equal(isVaultConfigError("Search returned 0 results"), false);
  });
});

describe("isVaultConfigError — cross-contamination guard", () => {
  it("a vault error does not match isMissingKeyError", () => {
    const vaultErr = "ENOENT: no such file or directory '/app/memory/notes.md'";
    assert.equal(isMissingKeyError(vaultErr), false);
    assert.equal(isVaultConfigError(vaultErr), true);
  });

  it("a missing-key error does not match isVaultConfigError", () => {
    const keyErr = 'Provider "openai" is not configured';
    assert.equal(isVaultConfigError(keyErr), false);
    assert.equal(isMissingKeyError(keyErr), true);
  });
});
