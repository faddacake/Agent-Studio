export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";

/**
 * GET /api/providers
 *
 * Returns the list of configured provider IDs (DB rows + env-var fallbacks).
 * Does NOT expose encrypted keys or auth tags.
 *
 * Used by the canvas to gate the Run button and by /getting-started to check
 * whether at least one provider API key has been added.
 * Env-var providers (FAL_API_KEY, REPLICATE_API_TOKEN, GOOGLE_API_KEY) are
 * included so that .env.local-only setups don't permanently disable the Run button.
 */
export async function GET() {
  const db = getDb();
  const rows = db
    .select({
      id: schema.providerConfigs.id,
      validatedAt: schema.providerConfigs.validatedAt,
      createdAt: schema.providerConfigs.createdAt,
    })
    .from(schema.providerConfigs)
    .all();

  // Supplement DB rows with any env-var-only providers so callers correctly
  // detect that a key is available even without a DB row.
  const dbIds = new Set(rows.map((r) => r.id));
  const envFallbacks: { id: string; validatedAt: null; createdAt: null; source: "env" }[] = [];
  const ENV_PROVIDERS: { id: string; envVar: string | undefined }[] = [
    { id: "fal",       envVar: process.env.FAL_API_KEY?.trim() },
    { id: "replicate", envVar: process.env.REPLICATE_API_TOKEN?.trim() },
    { id: "google",    envVar: process.env.GOOGLE_API_KEY?.trim() },
  ];
  for (const { id, envVar } of ENV_PROVIDERS) {
    if (envVar && !dbIds.has(id)) {
      envFallbacks.push({ id, validatedAt: null, createdAt: null, source: "env" });
    }
  }

  return NextResponse.json([...rows, ...envFallbacks]);
}
