export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";
import { resolveProviderKey } from "@/lib/providers/resolveProviderKey";

const KNOWN_PROVIDERS = new Set([
  "fal", "replicate", "google",
  "openai", "anthropic", "grok", "ollama",
  "elevenlabs", "stability", "midjourney",
  "bedrock", "azure",
]);

/**
 * POST /api/providers/:id/validate
 *
 * Tests whether an API key for a provider is accepted by that provider's
 * authentication endpoint. Uses a lightweight probe that does not trigger
 * any generation or incur cost:
 *
 *   fal        — GET https://fal.run/models  (returns 401 on bad key)
 *   replicate  — GET https://api.replicate.com/v1/models  (returns 401 on bad key)
 *   google     — format check only (no free auth endpoint available)
 *
 * Key resolution (in priority order):
 *   1. `apiKey` field in the JSON request body — pre-save validation, key is
 *      NOT stored. validatedAt is NOT updated in this mode.
 *   2. Stored encrypted key from providerConfigs — post-save validation.
 *      On success, sets providerConfigs.validatedAt = now().
 *
 * Returns { ok: true, validatedAt? } on success, { ok: false, message } on failure.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!KNOWN_PROVIDERS.has(id)) {
    return NextResponse.json({ error: "NOT_FOUND", message: "Unknown provider" }, { status: 404 });
  }

  // Accept an optional apiKey in the body for pre-save validation.
  // If present, use it directly and skip DB read/write.
  const body = await request.json().catch(() => ({})) as { apiKey?: unknown };
  const bodyKey = typeof body?.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : null;
  const isPreSave = bodyKey !== null;

  const apiKey = bodyKey ?? resolveProviderKey(id);
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "No API key configured for this provider" },
      { status: 400 },
    );
  }

  // ── Provider-specific lightweight auth probe ──────────────────────────────

  let valid = false;
  let probeMessage = "Connection failed";

  try {
    if (id === "fal") {
      // GET /requests for a known model — returns 401 on bad key, 200 on valid
      // (fal.run/models returns 404 regardless of auth, so we use a model route)
      const res = await fetch("https://fal.run/fal-ai/flux/requests", {
        method: "GET",
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.ok;
      if (!valid) probeMessage = "API key rejected by Fal.ai";
    } else if (id === "replicate") {
      // GET /v1/models — returns 401 on bad token, 200 on valid
      const res = await fetch("https://api.replicate.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Token ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.status !== 401 && res.status !== 403;
      if (!valid) probeMessage = "API key rejected by Replicate (401/403)";
    } else if (id === "google") {
      // Google Itera Studio keys start with "AIza" — basic format check only
      // (no free auth endpoint is available without initiating a model call)
      valid = apiKey.startsWith("AIza") && apiKey.length > 20;
      if (!valid) probeMessage = "Google AI key format looks incorrect (expected AIza...)";
    } else if (id === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.status !== 401 && res.status !== 403;
      if (!valid) probeMessage = "API key rejected by OpenAI (401/403)";
    } else if (id === "anthropic") {
      // No free auth probe — validate format only (sk-ant-api03-...)
      valid = apiKey.startsWith("sk-ant-") && apiKey.length > 30;
      if (!valid) probeMessage = "Anthropic key format looks incorrect (expected sk-ant-...)";
    } else if (id === "grok") {
      // xAI returns 400 "invalid argument" for malformed keys and 401 for missing creds
      // Use res.ok (2xx) to catch both cases reliably
      const res = await fetch("https://api.x.ai/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.ok;
      if (!valid) probeMessage = "API key rejected by xAI";
    } else if (id === "ollama") {
      // apiKey is the base URL for the Ollama server
      const baseUrl = apiKey.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      valid = res.ok;
      if (!valid) probeMessage = "Could not reach Ollama server — is it running at that URL?";
    } else if (id === "elevenlabs") {
      const res = await fetch("https://api.elevenlabs.io/v1/user", {
        method: "GET",
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.status !== 401 && res.status !== 403;
      if (!valid) probeMessage = "API key rejected by ElevenLabs (401/403)";
    } else if (id === "stability") {
      const res = await fetch("https://api.stability.ai/v1/user/account", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.status !== 401 && res.status !== 403;
      if (!valid) probeMessage = "API key rejected by Stability AI (401/403)";
    } else if (id === "midjourney") {
      // No public auth endpoint — length check only
      valid = apiKey.length > 10;
      if (!valid) probeMessage = "Midjourney token looks too short";
    } else if (id === "bedrock") {
      // Format: AKIAIOSFODNN7EXAMPLE:secretAccessKey:us-east-1
      const parts = apiKey.split(":");
      valid = parts.length >= 3 && parts[0].startsWith("AKIA") && parts[0].length === 20;
      if (!valid) probeMessage = "AWS credentials format incorrect (expected AKIA...:secret:region)";
    } else if (id === "azure") {
      // Format: https://my-resource.openai.azure.com|apiKey
      const pipeIdx = apiKey.indexOf("|");
      valid = pipeIdx > 0 && apiKey.startsWith("https://") && apiKey.length - pipeIdx > 10;
      if (!valid) probeMessage = "Azure format incorrect (expected https://your-resource.openai.azure.com|api-key)";
    }
  } catch (err) {
    probeMessage = err instanceof Error && err.name === "TimeoutError"
      ? "Connection timed out — check your network"
      : "Network error during validation";
  }

  if (!valid) {
    return NextResponse.json({ ok: false, message: probeMessage });
  }

  // ── Stamp validatedAt in DB (only for stored-key validation) ─────────────
  // Pre-save validation uses a caller-supplied key and must not write to DB.

  if (!isPreSave) {
    const now = new Date().toISOString();
    getDb()
      .update(schema.providerConfigs)
      .set({ validatedAt: now, updatedAt: now })
      .where(eq(schema.providerConfigs.id, id))
      .run();
    return NextResponse.json({ ok: true, validatedAt: now });
  }

  return NextResponse.json({ ok: true });
}
