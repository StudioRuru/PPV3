import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getEngine } from "@/lib/comfy/engine";
import { dropModels, freeVram } from "@/lib/comfy/client";
import { type Arch, type TrainKind, MAX_IMAGES, MIN_IMAGES, startTrain, trainName, trainStatus } from "@/lib/comfy/train";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Dozens of photos per upload, so like the LoRA route this skips the auth proxy (it buffers bodies) and checks the session itself.
const denied = async (req: NextRequest) => !!process.env.APP_PASSWORD && !(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  if (await denied(req)) return bad("Unauthorized", 401);
  if (getEngine().view().main.phase !== "ready") return NextResponse.json({ run: null, offline: true });
  try {
    const run = await trainStatus();
    if (run?.done) dropModels(); // LoRA list picks up the new file
    return NextResponse.json({ run });
  } catch (e) {
    console.error("[comfy] train status failed:", e);
    return bad("Couldn't reach the GPU.", 502);
  }
}

/** multipart: name, arch (sdxl|qwen), kind (face|scene), images (5–40 files). */
export async function POST(req: NextRequest) {
  if (await denied(req)) return bad("Unauthorized", 401);
  const f = await req.formData().catch(() => null);
  if (!f) return bad("Send the photos as a form.");
  const name = trainName(String(f.get("name") ?? ""));
  const arch = f.get("arch") as Arch, kind = f.get("kind") as TrainKind;
  const files = f.getAll("images").filter((x): x is File => x instanceof File);
  if (!name) return bad("Name: 3–40 lowercase letters, numbers or _ , starting with a letter.");
  if (arch !== "sdxl" && arch !== "qwen") return bad("Pick SDXL or Qwen.");
  if (kind !== "face" && kind !== "scene") return bad("Pick Face or Scene.");
  if (files.length < MIN_IMAGES || files.length > MAX_IMAGES) return bad(`Pick ${MIN_IMAGES}–${MAX_IMAGES} photos.`);
  if (getEngine().view().main.phase !== "ready") return bad("Start the GPU first.", 409);
  let images: Buffer[];
  try {
    // ponytail: no face crop; add a detector crop if face LoRAs come out weak
    images = await Promise.all(files.map(async (x) => sharp(Buffer.from(await x.arrayBuffer())).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer()));
  } catch {
    return bad("One of the photos couldn't be read (JPEG or PNG work best).");
  }
  try {
    await freeVram(getEngine().base("main")).catch(() => {}); // the trainer needs the VRAM
    return NextResponse.json({ run: await startTrain({ name, arch, kind, images }) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Couldn't start training.", 409);
  }
}
