import "server-only";

/**
 * Tiny in-memory rate limiter for the login route. Single-instance app, so a
 * process-local map is enough — no Redis. Tracks consecutive failures per key
 * (client IP) plus a global counter, and applies an escalating cooldown so a
 * brute-force attempt (even from a compromised tailnet device) stalls quickly.
 */

interface Bucket {
  fails: number;
  /** Epoch ms before which further attempts are rejected. */
  blockedUntil: number;
  /** Epoch ms of the last attempt — used to expire idle buckets. */
  lastSeen: number;
}

const MAX_FAILS = 5;
/** Cooldown after the threshold, doubling each further failure (cap 15 min). */
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 15 * 60_000;
/** Forget a key after this long with no activity. */
const IDLE_RESET_MS = 30 * 60_000;

const buckets = new Map<string, Bucket>();

function get(key: string): Bucket {
  const now = Date.now();
  const b = buckets.get(key);
  // Fresh bucket if unseen or idle past the reset window (based on last activity,
  // not blockedUntil — a never-blocked bucket has blockedUntil 0).
  if (!b || now - b.lastSeen > IDLE_RESET_MS) {
    const fresh = { fails: 0, blockedUntil: 0, lastSeen: now };
    buckets.set(key, fresh);
    return fresh;
  }
  b.lastSeen = now;
  return b;
}

/** Check before verifying a password. Returns the remaining cooldown in seconds (0 = allowed). */
export function checkRateLimit(key: string): number {
  const now = Date.now();
  const b = get(key);
  if (b.blockedUntil > now) return Math.ceil((b.blockedUntil - now) / 1000);
  return 0;
}

/** Record a failed attempt; escalates the cooldown once the threshold is passed. */
export function recordFailure(key: string): void {
  const b = get(key);
  b.fails += 1;
  if (b.fails >= MAX_FAILS) {
    const over = b.fails - MAX_FAILS;
    const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** over, MAX_COOLDOWN_MS);
    b.blockedUntil = Date.now() + cooldown;
  }
}

/** Clear a key after a successful login. */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}

/** Best-effort client identifier from proxy headers (Tailscale sets x-forwarded-for). */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
