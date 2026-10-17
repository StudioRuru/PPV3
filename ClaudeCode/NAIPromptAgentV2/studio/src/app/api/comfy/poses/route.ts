import { NextResponse } from "next/server";
import { comfyDb, listPoses, savePose } from "@/lib/comfy/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ poses: listPoses(comfyDb()) });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { name?: unknown; keypoints?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 60) return NextResponse.json({ error: "name must be 1–60 characters" }, { status: 400 });
  const k = b?.keypoints;
  if (!Array.isArray(k) || !k.length || k.length > 1000 || !k.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return NextResponse.json({ error: "keypoints must be a list of up to 1000 numbers" }, { status: 400 });
  }
  return NextResponse.json({ id: savePose(comfyDb(), name, k as number[]) });
}
