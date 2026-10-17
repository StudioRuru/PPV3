import { NextRequest, NextResponse } from "next/server";
import { comfyDb, readSettings, writeSettings, type ComfySettings } from "@/lib/comfy/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sane ranges for the three fields the Settings sheet edits (budgetUsd stays a dev-only DB value).
const RANGE = { dailyCapUsd: [1, 200], keepWarmMaxH: [1, 24], idleMin: [10, 240] } as const;

export function GET() {
  return NextResponse.json(readSettings(comfyDb()));
}

export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "JSON only." }, { status: 415 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const patch: Partial<ComfySettings> = {};
  for (const k of Object.keys(RANGE) as (keyof typeof RANGE)[]) {
    if (b[k] === undefined) continue;
    const n = b[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return NextResponse.json({ error: `${k} must be a number.` }, { status: 400 });
    patch[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], n));
  }
  try {
    return NextResponse.json(writeSettings(comfyDb(), patch));
  } catch (err) {
    console.error("comfy settings route failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Couldn't save GPU settings — try again." }, { status: 500 });
  }
}
