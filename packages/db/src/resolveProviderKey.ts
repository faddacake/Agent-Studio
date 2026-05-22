/**
 * Resolve a provider's API key from the DB.
 *
 * Reads the encrypted row from providerConfigs, reconstructs the
 * EncryptedData shape (salt stored as "{salt}:{ciphertext}" in
 * apiKeyEncrypted), and decrypts with @aistudio/crypto.
 *
 * Lives in @aistudio/db so it can be used by both the web server
 * (runs/route.ts) and the worker (nodeJobProcessor.ts) without either
 * package importing the other.
 *
 * Returns the plaintext key, or null if not configured.
 * Never throws — callers should treat null as "not configured".
 */

import { decrypt } from "@aistudio/crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./index.js";
import * as schema from "./schema.js";

export function resolveProviderKey(providerId: string): string | null {
  try {
    const row = getDb()
      .select({
        apiKeyEncrypted: schema.providerConfigs.apiKeyEncrypted,
        iv:              schema.providerConfigs.iv,
        authTag:         schema.providerConfigs.authTag,
      })
      .from(schema.providerConfigs)
      .where(eq(schema.providerConfigs.id, providerId))
      .get();

    if (!row) return null;

    // apiKeyEncrypted is stored as "{salt}:{ciphertext}"
    const colonIdx = row.apiKeyEncrypted.indexOf(":");
    if (colonIdx === -1) return null;

    const salt       = row.apiKeyEncrypted.slice(0, colonIdx);
    const ciphertext = row.apiKeyEncrypted.slice(colonIdx + 1);

    return decrypt({ salt, ciphertext, iv: row.iv, authTag: row.authTag });
  } catch {
    return null;
  }
}
