import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isDevSecret, signSession } from "@/lib/auth";
import { APP_PASSWORD, AUTH_ENABLED } from "@/lib/env";
import { checkRateLimit, clientKey, recordFailure, recordSuccess } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Length-independent constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison to avoid early-return timing leaks.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  // No password configured → auth disabled, nothing to log in to.
  if (!AUTH_ENABLED) {
    return NextResponse.json({ ok: true, authDisabled: true });
  }

  // Fail closed: with a password gate active but no real signing secret, any
  // session we mint would be forgeable. Refuse rather than hand out a token.
  if (isDevSecret()) {
    return NextResponse.json(
      { error: "Server misconfigured: set SESSION_SECRET before enabling the password gate." },
      { status: 500 },
    );
  }

  // Brute-force throttle (per client IP).
  const key = clientKey(req);
  const cooldown = checkRateLimit(key);
  if (cooldown > 0) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${cooldown}s.` },
      { status: 429, headers: { "Retry-After": String(cooldown) } },
    );
  }

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !safeEqual(password, APP_PASSWORD)) {
    recordFailure(key);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  recordSuccess(key);
  const token = await signSession();
  const res = NextResponse.json({ ok: true });
  // Mark the cookie Secure when the request arrived over HTTPS (e.g. behind
  // `tailscale serve`); stay non-Secure over plain tailnet/LAN HTTP so it still sets.
  const secure = req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
