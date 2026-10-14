import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/db";
import { autoDeleteDays, sweepExpired } from "@/lib/generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-side settings that must outlive the page: the camera roll's auto-delete window. */
export function GET() {
  return NextResponse.json({ autoDeleteDays: autoDeleteDays() });
}

export async function POST(req: NextRequest) {
  const days = ((await req.json().catch(() => null)) ?? {}).autoDeleteDays;
  if (![1, 2, 3, null].includes(days)) return NextResponse.json({ error: "autoDeleteDays must be 1, 2, 3 or null (never)." }, { status: 400 });
  setSetting("auto_delete_days", String(days ?? 0));
  const removed = await sweepExpired(Date.now() + 60_001); // apply now, not on the next listing
  return NextResponse.json({ autoDeleteDays: days, removed });
}
