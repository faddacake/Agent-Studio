import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";

export type { LicenseTier, TierLimits } from "./license-tiers";
export { TIER_LIMITS } from "./license-tiers";

import type { LicenseTier } from "./license-tiers";

const SETTINGS_KEY = "license_tier";

export function getLicenseTier(): LicenseTier {
  try {
    const db = getDb();
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, SETTINGS_KEY))
      .get();
    const value = row?.value as string | undefined;
    if (value === "free" || value === "creator" || value === "pro") return value;
  } catch {
    // DB not available — default
  }
  return "creator";
}

export function setLicenseTier(tier: LicenseTier): void {
  const db = getDb();
  db.insert(schema.settings)
    .values({ key: SETTINGS_KEY, value: tier })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: tier } })
    .run();
}
