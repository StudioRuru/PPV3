import { NextResponse } from "next/server";
import { comfyDb, readJob } from "@/lib/comfy/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const j = readJob(comfyDb(), Number((await params).id));
  if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = (j.recipe as { result?: unknown } | null)?.result;
  return NextResponse.json({ status: j.status, progress: j.progress, error: j.error, itemId: j.itemId, ...(result === undefined ? {} : { result }) });
}
