import { NextRequest, NextResponse } from "next/server";
import { quip } from "@/lib/mascot/quip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One Miyabi line for a client event; always 200 (canned fallback). */
export async function POST(req: NextRequest) {
  return NextResponse.json(await quip(await req.json().catch(() => null)));
}
