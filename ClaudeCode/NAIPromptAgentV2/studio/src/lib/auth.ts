/**
 * Session helpers. Edge-safe (used by middleware) — no node:crypto, no
 * server-only. Authentication is a single shared app password (APP_PASSWORD);
 * a successful login mints a signed JWT stored in an httpOnly cookie.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "studio_session";
const SESSION_TTL = "30d";

/** Fallback used when SESSION_SECRET is unset — JWTs signed with it are forgeable. */
const DEV_SECRET = "dev-insecure-secret-change-me";

// Read directly from process.env (not @/lib/env) so this module stays edge-safe
// for use in middleware — @/lib/env imports node:path.
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || DEV_SECRET);

/**
 * True when no real signing secret is configured (unset or still the dev
 * default). Sessions are then forgeable, so callers must refuse to mint one when
 * a password gate is otherwise active. Env-only, so it stays edge-safe.
 */
export function isDevSecret(): boolean {
  const s = process.env.SESSION_SECRET;
  return !s || s === DEV_SECRET;
}

export async function signSession(): Promise<string> {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret);
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  // Fail closed: a JWT signed with the public dev secret is forgeable by anyone.
  if (!token || isDevSecret()) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}
