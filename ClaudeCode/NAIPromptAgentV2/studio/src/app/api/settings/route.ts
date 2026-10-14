import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/db";
import { autoDeleteDays, countExpired, sweepExpired } from "@/lib/generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-side settings that must outlive the page: the camera roll's auto-delete window. */
export function GET() {
  return NextResponse.json({ autoDeleteDays: autoDeleteDays() });
}

/**
 * { autoDeleteDays, dryRun? } — dryRun returns how many images would be deleted now, so the UI can confirm first.
 * JSON content-type required: a plain-text cross-site form post can't trigger a purge.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "JSON only." }, { status: 415 });
  const { autoDeleteDays: days, dryRun } = ((await req.json().catch(() => null)) ?? {}) as { autoDeleteDays?: unknown; dryRun?: unknown };
  if (!(days === 1 || days === 2 || days === 3 || days === null)) return NextResponse.json({ error: "autoDeleteDays must be 1, 2, 3 or null (never)." }, { status: 400 });
  if (dryRun === true) return NextResponse.json({ wouldRemove: countExpired(days) });
  setSetting("auto_delete_days", String(days ?? 0));
  return NextResponse.json({ autoDeleteDays: days, removed: await sweepExpired({ force: true }) });
}
