import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getEngine } from "@/lib/comfy/engine";
import { dropModels, freeVram } from "@/lib/comfy/client";
import { picksPayload } from "@/lib/sprites/trainset";
import { POSE_FAMILY, type Arch, type TrainKind, MAX_IMAGES, MIN_IMAGES, startTrain, trainName, trainStatus } from "@/lib/comfy/train";

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
  if (req.headers.get("content-type")?.includes("application/json")) return trainset(req);
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

/** json: { trainset: true, name, arch (POSE_FAMILY|wan22), kind } trains on the picked Sprites training-set renders. */
async function trainset(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { trainset?: unknown; name?: unknown; arch?: unknown; kind?: unknown } | null;
  const name = trainName(String(b?.name ?? ""));
  if (!b || b.trainset !== true) return bad("Send the photos as a form.");
  if (name !== "miyabi_sprite_img" && name !== "miyabi_sprite_wan") return bad("Name must be miyabi_sprite_img or miyabi_sprite_wan.");
  if (b.arch !== POSE_FAMILY && b.arch !== "wan22") return bad("Pick the image or Wan model.");
  if ((name === "miyabi_sprite_img") !== (b.arch === POSE_FAMILY)) return bad("miyabi_sprite_img trains the image model and miyabi_sprite_wan the Wan model.");
  if (b.arch === "wan22" && process.env.SPRITE_WAN_BASE_READY !== "1") return bad("The Wan base (~57 GB) isn't approved yet — set SPRITE_WAN_BASE_READY=1 after the disk decision", 409);
  const kind: TrainKind = "face"; // both sprite LoRAs learn a character
  let payload;
  try { payload = await picksPayload(); } catch (e) { return bad(e instanceof Error ? e.message : "Couldn't read the picks."); }
  if (getEngine().view().main.phase !== "ready") return bad("Start the GPU first.", 409);
  try {
    await freeVram(getEngine().base("main")).catch(() => {});
    return NextResponse.json({ run: await startTrain({ name, arch: b.arch, kind, ...payload }) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Couldn't start training.", 409);
  }
}
