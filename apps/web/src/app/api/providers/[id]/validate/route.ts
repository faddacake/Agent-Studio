export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@aistudio/db";
import { eq } from "drizzle-orm";
import { resolveProviderKey } from "@/lib/providers/resolveProviderKey";

const KNOWN_PROVIDERS = new Set(["fal", "replicate", "google"]);

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
      // GET https://fal.run/models — requires valid key, returns 401 if not
      const res = await fetch("https://fal.run/models", {
        method: "GET",
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      valid = res.status !== 401 && res.status !== 403;
      if (!valid) probeMessage = "API key rejected by Fal.ai (401/403)";
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
      // Google AI Studio keys start with "AIza" — basic format check only
      // (no free auth endpoint is available without initiating a model call)
      valid = apiKey.startsWith("AIza") && apiKey.length > 20;
      if (!valid) probeMessage = "Google AI key format looks incorrect (expected AIza...)";
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
