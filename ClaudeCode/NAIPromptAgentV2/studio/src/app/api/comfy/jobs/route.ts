import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { getEngine, Refused } from "@/lib/comfy/engine";
import { drainQueue } from "@/lib/comfy/jobs";
import { cachedModels } from "@/lib/comfy/client";
import { canStart } from "@/lib/comfy/spend";
import { validatePhoto, validatePose, validateVideo } from "@/lib/comfy/recipe";
import { type Card, type JobKind, addJob, comfyDb, readSettings, runs } from "@/lib/comfy/store";
import { COMFY_DIR } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** base64 (or data URL) → PNG at most 1536 px on the long side. Throws a user-facing message. */
async function decode(b64: unknown): Promise<Buffer> {
  if (typeof b64 !== "string") throw new Error("Images must be base64 text.");
  const s = b64.replace(/^data:[^,]*,/, "");
  if (s.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Error("That image is too large (20 MB max).");
  const buf = Buffer.from(s, "base64");
  if (!buf.length || buf.length > MAX_BYTES) throw new Error(buf.length ? "That image is too large (20 MB max)." : "The image is empty.");
  try {
    return await sharp(buf).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new Error("That file isn't an image.");
  }
}

/** {kind, recipe, image?, poseImage?} → {id}. Validates names against the pod when it's ready, otherwise drainQueue does. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { kind?: JobKind; recipe?: unknown; image?: unknown; poseImage?: unknown } | null;
  if (!b || !["photo", "video", "pose"].includes(b.kind as string)) return bad("kind must be photo, video or pose");
  if (!b.recipe || typeof b.recipe !== "object" || Array.isArray(b.recipe)) return bad("recipe must be an object");
  const kind = b.kind as JobKind;
  const recipe = { ...(b.recipe as Record<string, unknown>) };
  const stamp = Date.now();
  const files: [string, Buffer][] = [];
  try {
    if (b.image != null) {
      const name = `ref-${stamp}.png`;
      files.push([name, await decode(b.image)]);
      if (kind === "video") recipe.startImage = name;
      else if (kind === "pose") recipe.image = name;
      else return bad("Photo jobs take a poseImage, not an image");
    }
    if (b.poseImage != null) {
      if (kind !== "photo" || !recipe.pose || typeof recipe.pose !== "object") return bad("poseImage needs a photo recipe with a pose");
      const name = `pose-${stamp}.png`;
      files.push([name, await decode(b.poseImage)]);
      recipe.pose = { ...(recipe.pose as object), image: name };
    }
  } catch (e) {
    return bad((e as Error).message);
  }

  try {
    const eng = getEngine();
    const views = eng.view();
    const card: Card = kind === "video" && recipe.mode !== "t2v" && views.main.boost === "on" ? "boost" : "main";
    const models = views[card].phase === "ready" ? await cachedModels(eng.base(card)).catch(() => undefined) : undefined;
    let valid: object;
    try {
      valid = kind === "photo" ? validatePhoto(recipe, models) : kind === "video" ? validateVideo(recipe, models) : validatePose(recipe);
    } catch (e) {
      return bad((e as Error).message);
    }
    const ok = canStart({ runs: runs(comfyDb()), s: readSettings(comfyDb()), now: Date.now() }); // warm() only checks when it starts a VM
    if (!ok.ok) return NextResponse.json({ error: ok.why }, { status: 409 });
    try {
      await eng.warm(card);
    } catch (e) {
      if (e instanceof Refused) return NextResponse.json({ error: e.message }, { status: 409 });
      // other warm failures: the engine shows them in its view; drainQueue retries the warm
    }
    fs.mkdirSync(COMFY_DIR, { recursive: true });
    for (const [name, buf] of files) fs.writeFileSync(path.join(COMFY_DIR, name), buf);
    const id = addJob(comfyDb(), kind, valid, card, Date.now());
    void drainQueue().catch(() => {});
    return NextResponse.json({ id });
  } catch (err) {
    console.error("comfy jobs route failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Couldn't queue the job — try again." }, { status: 500 });
  }
}
