import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getEngine } from "@/lib/comfy/engine";
import { dropModels } from "@/lib/comfy/client";
import { listLoras, loraName, LoraError, pushLoras, saveLora } from "@/lib/comfy/loras";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// LoRAs run to gigabytes, so this route skips the auth proxy (it buffers bodies) and checks the session itself.
const denied = async (req: NextRequest) => !!process.env.APP_PASSWORD && !(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));

export async function GET(req: NextRequest) {
  if (await denied(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ loras: await listLoras() });
}

/** PUT ?name=x.safetensors with the raw file as the body. Saved on the Mac, then sent to the main pod if it's up. */
export async function PUT(req: NextRequest) {
  if (await denied(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const name = loraName(req.nextUrl.searchParams.get("name") ?? "");
  if (!name) return NextResponse.json({ error: "Pick a .safetensors file (plain name, no quotes or slashes)." }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Empty upload." }, { status: 400 });
  try {
    await saveLora(name, req.body);
  } catch (e) {
    if (e instanceof LoraError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (getEngine().view().main.phase !== "ready") return NextResponse.json({ name, pushed: false });
  try {
    await pushLoras();
    dropModels();
    return NextResponse.json({ name, pushed: true });
  } catch (e) {
    console.error("[comfy] lora push failed:", e);
    return NextResponse.json({ name, pushed: false });
  }
}
