import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb, schema } from "@iterastudio/db";
import { getMasterKey } from "@iterastudio/crypto";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "aistudio_session";
const TOKEN_EXPIRY = "7d";

function getSigningKey(): Uint8Array {
  const masterKey = getMasterKey();
  return new Uint8Array(masterKey);
}

export async function createSessionToken(): Promise<string> {
  const key = getSigningKey();
  return new SignJWT({ iss: "aistudio" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(key);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const key = getSigningKey();
    await jwtVerify(token, key, { issuer: "aistudio" });
    return true;
  } catch {
    return false;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });
}

export async function getSessionFromCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return false;
  return verifySessionToken(cookie.value);
}

export function isSetupComplete(): boolean {
  const db = getDb();
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, "password_hash")).get();
  return !!row;
}

export function getPasswordHash(): string | null {
  const db = getDb();
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, "password_hash")).get();
  return row ? (row.value as string) : null;
}

export function setPasswordHash(hash: string): void {
  const db = getDb();
  db.insert(schema.settings)
    .values({ key: "password_hash", value: hash })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: hash } })
    .run();
}
