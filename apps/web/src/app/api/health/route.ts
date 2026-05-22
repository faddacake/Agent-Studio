export const runtime = "nodejs";

import { NextResponse } from "next/server";

const SERVER_BOOT = new Date().toISOString();
if (process.env.NODE_ENV !== "production") {
  console.log(`[health] Server module loaded at ${SERVER_BOOT} | NODE_ENV=${process.env.NODE_ENV} | PORT=${process.env.PORT ?? "default"}`);
}

export async function GET() {
  const health: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    serverBoot: SERVER_BOOT,
    nodeEnv: process.env.NODE_ENV,
  };

  // DB check — optional, don't fail liveness if DB is unavailable
  try {
    const { getDb } = await import("@iterastudio/db");
    getDb();
    health.db = "connected";
  } catch (err: any) {
    console.error("[health] DB health check failed:", err?.message);
    health.db = "error";
    health.dbError = err?.message ?? String(err);
  }

  return NextResponse.json(health);
}

