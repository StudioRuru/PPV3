import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { getAruSettings, getMascotSettings, profileSpriteDir, saveAruSettings } from "@/lib/mascot/settings-db";
import { isProfile, profileLook, type Profile } from "@/lib/mascot/profiles";
import { clipAllowed, clipCount, generateClip, keyRequest, listSprites, MAX_CANDIDATES, newSeed, OUTFITS, perImage, pick, pickClip, saveCandidates, saveClipMasks, sheetPath, poseRequest, spriteRequest, talkRequest, target } from "@/lib/mascot/sprites";
import { CLIP_KINDS, isClipKind, type ClipKind } from "@/lib/mascot/clips";
import type { Outfit } from "@/lib/mascot/core";
import { anlas, generateImage, measured, NovelAIError } from "@/lib/novelai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SHEET = 20 * 1024 * 1024;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const balance = () => anlas(NOVELAI_TOKEN, 5000).catch(() => null);

/** Aru's editable tags. */
export async function GET() {
  return NextResponse.json({ aru: getAruSettings() });
}

/** Mascot studio: sheet upload (multipart), estimate, generate (confirm: true), pick; body.profile "aru" draws portraits in her folder; action "aru-tags" saves her tags. */
export async function POST(req: NextRequest) {
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    const outfit = fd?.get("outfit");
    const file = fd?.get("file");
    if (fd?.get("action") !== "sheet" || !OUTFITS.includes(outfit as Outfit)) return bad("Expected action=sheet and an outfit.");
    if (!(file instanceof Blob) || !file.size || file.size > MAX_SHEET || !file.type.startsWith("image/")) return bad("Upload an image up to 20 MB.");
    const out = sheetPath(profileSpriteDir(null), outfit as Outfit); // Miyabi only
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true });
  }

  const b = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown; n?: unknown; i?: unknown; confirm?: unknown; profile?: unknown; patch?: unknown; baseKey?: unknown; kind?: unknown; kinds?: unknown; masks?: unknown };
  if (b.action === "aru-tags") return NextResponse.json({ aru: saveAruSettings(b.patch) });
  if (b.profile !== undefined && !isProfile(b.profile)) return bad("Unknown profile.");
  const profile: Profile = b.profile ?? "miyabi";
  if (typeof b.action === "string" && b.action.startsWith("clip-")) return clipAction(req, b, profile);
  const t = target(b);
  if (!t) return bad("Unknown outfit or expression.");
  if (profile === "aru" && (!t.talk || t.outfit !== "day")) return bad("Aru only has day portraits.");
  const dir = profileSpriteDir(profile); // the profile's folder, fixed for this request
  const look = () => profileLook(profile, getMascotSettings(), getAruSettings());
  const request = (seed?: number) => (t.talk ? talkRequest(t.outfit, t.talk, look(), seed) : t.pose ? poseRequest(t.outfit, t.pose, t.pose === "back" ? null : t.expr, look(), seed) : spriteRequest(t.outfit, t.kind, t.expr, look(), seed));
  const n = Number.isInteger(b.n) ? Math.min(MAX_CANDIDATES, Math.max(1, b.n as number)) : 3;

  if (b.action === "estimate") {
    return NextResponse.json({ anlas: await balance(), perImage: perImage(request().params), n });
  }
  if (b.action === "generate") {
    if (b.confirm !== true) return bad("Confirm the spend first.");
    try {
      const before = await balance();
      const seeds: number[] = [];
      const { result: pngs, cost } = await measured(NOVELAI_TOKEN, async () => {
        const out: Buffer[] = [];
        for (let i = 0; i < n; i++) {
          const seed = newSeed();
          const { compiled, params } = request(seed);
          seeds.push(seed);
          out.push((await generateImage(compiled, params, NOVELAI_TOKEN)).png);
        }
        return out;
      });
      saveCandidates(dir, t.outfit, t.name, pngs, seeds, t.pose, t.talk); // only after the whole batch, so a failure replaces nothing
      return NextResponse.json({ count: pngs.length, before, after: await balance(), cost });
    } catch (err) {
      const status = err instanceof NovelAIError ? err.status : 500;
      return bad((err as Error).message, status >= 400 ? status : 502);
    }
  }
  if (b.action === "pick") {
    const r = await pick(dir, t.outfit, t.name, Number(b.i), undefined, t.pose, t.talk);
    return "error" in r ? bad(r.error, 404) : NextResponse.json(r);
  }
  return bad("Unknown action.");
}

/** Frame clips off an existing sprite: clip-estimate {baseKey, kinds?, n?}, clip-generate {baseKey, kind, n?, confirm: true}, clip-pick {baseKey, kind, i}, clip-masks {baseKey, masks}. */
async function clipAction(req: NextRequest, b: { action?: unknown; n?: unknown; i?: unknown; confirm?: unknown; baseKey?: unknown; kind?: unknown; kinds?: unknown; masks?: unknown }, profile: Profile) {
  const dir = profileSpriteDir(profile);
  const baseKey = typeof b.baseKey === "string" && listSprites(dir).sprites[b.baseKey] ? b.baseKey : null; // existing sprites in this profile only
  if (!baseKey) return bad("Unknown sprite.");
  const look = profileLook(profile, getMascotSettings(), getAruSettings());
  const n = Number.isInteger(b.n) ? Math.min(MAX_CANDIDATES, Math.max(1, b.n as number)) : 1;

  if (b.action === "clip-estimate") {
    const playable = CLIP_KINDS.filter((k) => clipAllowed(dir, baseKey, k));
    const kinds = b.kinds === undefined ? playable : Array.isArray(b.kinds) && b.kinds.length && b.kinds.every((k) => playable.includes(k)) ? (b.kinds as ClipKind[]) : null;
    if (!kinds) return bad("That clip can't play on this sprite.");
    return NextResponse.json({ anlas: await balance(), perImage: perImage(keyRequest(baseKey, look)!.params), count: clipCount(kinds, n), n });
  }
  if (b.action === "clip-masks") return NextResponse.json({ manifest: saveClipMasks(dir, baseKey, b.masks) });
  if (!isClipKind(b.kind)) return bad("Unknown clip kind.");
  const kind = b.kind;
  if (b.action === "clip-generate") {
    if (b.confirm !== true) return bad("Confirm the spend first.");
    if (!clipAllowed(dir, baseKey, kind)) return bad("That clip can't play on this sprite.");
    try {
      const before = await balance();
      const { result, cost } = await measured(NOVELAI_TOKEN, () =>
        generateClip(dir, baseKey, kind, look, n, async (c, p, i2i, inf) => (await generateImage(c, p, NOVELAI_TOKEN, i2i, undefined, inf)).png, req.signal));
      return NextResponse.json({ count: result.count, before, after: await balance(), cost });
    } catch (err) {
      const status = err instanceof NovelAIError ? err.status : 500;
      return bad((err as Error).message, status >= 400 ? status : 502);
    }
  }
  if (b.action === "clip-pick") {
    const r = await pickClip(dir, baseKey, kind, Number(b.i));
    return "error" in r ? bad(r.error, 404) : NextResponse.json(r);
  }
  return bad("Unknown action.");
}
