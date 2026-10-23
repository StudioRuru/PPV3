import { NextRequest, NextResponse } from "next/server";
import { comfyDb } from "@/lib/comfy/store";
import { loraName } from "@/lib/comfy/loras";
import { readManifest } from "@/lib/comfy/pod";
import { resolveInfo } from "@/lib/comfy/lora-info";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?names=a.safetensors,b.safetensors — family, trigger words and weight per LoRA. Lookup failures come back as unknown, never an error. */
export async function GET(req: NextRequest) {
  const names = (req.nextUrl.searchParams.get("names") ?? "").split(",").filter(Boolean);
  if (names.length > 100 || names.some((n) => !loraName(n))) return NextResponse.json({ error: "Up to 100 plain .safetensors names." }, { status: 400 });
  let manifestSha = new Map<string, string>();
  try { manifestSha = new Map(readManifest().filter((e) => e.kind === "loras").map((e) => [e.filename, e.sha256])); } catch { /* no manifest: Mac files only */ }
  return NextResponse.json({ info: await resolveInfo(names, { db: comfyDb(), manifestSha }) });
}
