export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { encrypt } from "@iterastudio/crypto";
import { eq } from "drizzle-orm";

const KNOWN_PROVIDERS = new Set([
  "fal", "replicate", "google",
  "openai", "anthropic", "grok", "ollama",
  "elevenlabs", "stability", "midjourney",
  "bedrock", "azure",
]);

/**
 * POST /api/providers/:id
 *
 * Save or update a provider API key.
 * Encrypts the key with AES-256-GCM (via /crypto) before storing.
 * The salt is embedded in api_key_encrypted as "${salt}:${ciphertext}".
 * Never returns the key to the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!KNOWN_PROVIDERS.has(id)) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Unknown provider" },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const apiKey: unknown = body?.apiKey;

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "apiKey is required" },
      { status: 400 },
    );
  }

  const encrypted = encrypt(apiKey.trim());
  const now = new Date().toISOString();

  const db = getDb();
  const existing = db
    .select({ id: schema.providerConfigs.id })
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.id, id))
    .get();

  if (existing) {
    db.update(schema.providerConfigs)
      .set({
        apiKeyEncrypted: `${encrypted.salt}:${encrypted.ciphertext}`,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        validatedAt: null, // reset validation status on key change
        updatedAt: now,
      })
      .where(eq(schema.providerConfigs.id, id))
      .run();
  } else {
    db.insert(schema.providerConfigs)
      .values({
        id,
        apiKeyEncrypted: `${encrypted.salt}:${encrypted.ciphertext}`,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        validatedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/providers/:id
 *
 * Remove a provider configuration entirely.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const db = getDb();
  db.delete(schema.providerConfigs)
    .where(eq(schema.providerConfigs.id, id))
    .run();

  return NextResponse.json({ ok: true });
}
