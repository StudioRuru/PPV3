// Mascot sprite files + NovelAI request builder. Files live under data/mascot (see spec §1).
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR, TAGGER_URL } from "../env";
import { canResend, DEFAULT_PARAMS, type Img2Img, type Infill, type NaiParams } from "../nai-body";
import type { Compiled } from "../prompt";
import { CLIP_SPEC, clipPath, clipRequests, decodeBaseKey, defaultMasks, encodeBaseKey, isBaseKey, isClipKind, manifestPath, clampMask, validateManifest, type ClipKind, type Manifest, type Mask } from "./clips";
import { EXPRESSIONS, OUTFITS, type Expression, type Outfit } from "./core";
import { POSE_SPEC, POSES, poseKey, type Pose } from "./poses";
import { isSafeSpriteDir, type MascotSettings } from "./settings";
import { TALK, TALK_FRAMES, TALK_FRAME_TAGS, TALK_UC, talkKey, type TalkFrame } from "./talk";

/** The tag fields a sprite request draws from (MascotSettings and ProfileLook both fit). */
type Look = Pick<MascotSettings, "charTags" | "constantTags" | "layerTags" | "exprTags">;

export const MASCOT_DIR = path.join(DATA_DIR, "mascot");

/** A look's sprite folder under data/mascot ("" = data/mascot itself); null if it would escape. */
export function spriteDirFor(dir: string): string | null {
  const out = path.resolve(MASCOT_DIR, dir);
  return isSafeSpriteDir(dir) && (out === MASCOT_DIR || out.startsWith(MASCOT_DIR + path.sep)) ? out : null;
}
export { OUTFITS };
export type ArtKind = "bust" | "full";
export const MAX_CANDIDATES = 4;

export const BUST = "portrait, close-up, head and shoulders, bust, face focus, looking at viewer, simple background, white background";
export const BUST_UC = "full body, legs, thighs, feet, shoes, wide shot, lower body";
const FULL = "full body, standing, hand on hip, looking at viewer, simple background, white background";

/** A fresh random seed in 1..2^32-1, drawn per candidate so every batch differs. */
export const newSeed = (): number => randomInt(1, 2 ** 32);

/** Tags-only V5 request (no reference image: Precise Reference doesn't work on V5). */
export function spriteRequest(outfit: Outfit, kind: ArtKind, expr: Expression, s: Look, seed = newSeed()): { compiled: Compiled; params: NaiParams } {
  const parts = [s.charTags, s.constantTags, s.layerTags[outfit], ...(kind === "bust" ? [s.exprTags[expr], BUST] : [FULL])];
  const [width, height] = kind === "bust" ? [1024, 1024] : [832, 1216];
  return {
    compiled: { base: parts.map((p) => p.trim()).filter(Boolean).join(", "), uc: kind === "bust" ? BUST_UC : "", chars: [], rating: "nsfw" },
    params: { ...DEFAULT_PARAMS, width, height, steps: 28, seed },
  };
}

const TWO_VIEW = "multiple views, reference sheet, inset, split screen";
export const POSE_UC = `${TWO_VIEW}, close-up, portrait, upper body, cropped`;
const PEEK_UC = TWO_VIEW; // peek is upper-body by design

/** Tags-only request for a pose sprite (framing tags first so they dominate); faced poses add the expression tags, back view none. No bust UC (full body). */
export function poseRequest(outfit: Outfit, pose: Pose, expr: Expression | null, s: Look, seed = newSeed()): { compiled: Compiled; params: NaiParams } {
  const { tags, width, height, faced } = POSE_SPEC[pose];
  const parts = [tags, s.charTags, s.constantTags, s.layerTags[outfit], ...(faced && expr ? [s.exprTags[expr]] : [])];
  return {
    compiled: { base: parts.map((p) => p.trim()).filter(Boolean).join(", "), uc: pose === "peek" ? PEEK_UC : POSE_UC, chars: [], rating: "nsfw" },
    params: { ...DEFAULT_PARAMS, width, height, steps: 28, seed },
  };
}

/** Tags-only request for a waist-up talk portrait: expression frames add the expression tags, think/talk/listen frames their own small set. */
export function talkRequest(outfit: Outfit, frame: TalkFrame, s: Look, seed = newSeed()): { compiled: Compiled; params: NaiParams } {
  const tags = isTalkExpr(frame) ? s.exprTags[frame] : TALK_FRAME_TAGS[frame];
  const parts = [s.charTags, s.constantTags, s.layerTags[outfit], tags, TALK];
  return {
    compiled: { base: parts.map((p) => p.trim()).filter(Boolean).join(", "), uc: TALK_UC, chars: [], rating: "nsfw" },
    params: { ...DEFAULT_PARAMS, width: 1024, height: 1024, steps: 28, seed },
  };
}
const isTalkExpr = (f: TalkFrame): f is Expression => EXPRESSIONS.includes(f as Expression);

/** Anlas per image on Opus: free up to 1 Mpx at ≤28 steps; otherwise unknown until measured. */
export const perImage = (p: NaiParams): number | null => (p.width * p.height <= 1048576 && p.steps <= 28 ? 0 : null);

const isOutfit = (o: unknown): o is Outfit => OUTFITS.includes(o as Outfit);
const isName = (n: unknown): n is Expression | "full" => n === "full" || EXPRESSIONS.includes(n as Expression);

const isTalk = (f: unknown): f is TalkFrame => TALK_FRAMES.includes(f as TalkFrame);
const isPose = (p: unknown): p is Pose => POSES.includes(p as Pose);

/** Untrusted {outfit, kind, expr, pose?, talk?} → a valid target (full ignores expr; back ignores expr; pose set = pose sprite), or null. */
export function target(b: unknown): { outfit: Outfit; kind: ArtKind; expr: Expression; name: Expression | "full" | TalkFrame; pose?: Pose; talk?: TalkFrame } | null {
  const { outfit, kind = "bust", expr, pose, talk } = (b ?? {}) as Record<string, unknown>;
  if (talk !== undefined) return isOutfit(outfit) && isTalk(talk) ? { outfit, kind: "bust", expr: isTalkExpr(talk) ? talk : "smug", name: talk, talk } : null;
  if (pose !== undefined) {
    if (!isOutfit(outfit) || !isPose(pose)) return null;
    if (pose === "back") return { outfit, kind: "bust", expr: "smug", name: "smug", pose };
    return EXPRESSIONS.includes(expr as Expression) ? { outfit, kind: "bust", expr: expr as Expression, name: expr as Expression, pose } : null;
  }
  if (!isOutfit(outfit) || (kind !== "bust" && kind !== "full")) return null;
  if (kind === "full") return { outfit, kind, expr: "smug", name: "full" };
  return EXPRESSIONS.includes(expr as Expression) ? { outfit, kind, expr: expr as Expression, name: expr as Expression } : null;
}

/** Whitelisted paths only: a known outfit and an expression or "full". */
export const spritePath = (dir: string, outfit: string, name: string): string | null =>
  isOutfit(outfit) && isName(name) ? path.join(dir, outfit, `${name}.png`) : null;

/** `<dir>/pose/<pose>/<outfit>/<expr>.png`, or `<dir>/pose/back/<outfit>.png`; whitelisted names only. */
export function posePath(dir: string, pose: string, outfit: string, expr: string | null): string | null {
  if (!isPose(pose) || !isOutfit(outfit)) return null;
  if (pose === "back") return path.join(dir, "pose", "back", `${outfit}.png`);
  return EXPRESSIONS.includes(expr as Expression) ? path.join(dir, "pose", pose, outfit, `${expr}.png`) : null;
}

/** Candidate i for a pose sprite: `<dir>/candidates/pose/<pose>/<outfit>/<expr|back>/<i>.png`. */
export function poseCandidatePath(dir: string, pose: string, outfit: string, expr: string | null, i: number): string | null {
  const p = posePath(dir, pose, outfit, expr);
  return p && Number.isInteger(i) && i >= 0 && i < MAX_CANDIDATES
    ? path.join(dir, "candidates", "pose", pose, outfit, pose === "back" ? "back" : expr!, `${i}.png`) : null;
}

/** `<dir>/talk/<outfit>/<frame>.png`; whitelisted names only. */
export const talkPath = (dir: string, outfit: string, name: string): string | null =>
  isOutfit(outfit) && isTalk(name) ? path.join(dir, "talk", outfit, `${name}.png`) : null;

/** Candidate i for a talk portrait: `<dir>/candidates/talk/<outfit>/<frame>/<i>.png`. */
export const talkCandidatePath = (dir: string, outfit: string, name: string, i: number): string | null =>
  isOutfit(outfit) && isTalk(name) && Number.isInteger(i) && i >= 0 && i < MAX_CANDIDATES ? path.join(dir, "candidates", "talk", outfit, name, `${i}.png`) : null;

export const candidatePath = (dir: string, outfit: string, name: string, i: number): string | null =>
  isOutfit(outfit) && isName(name) && Number.isInteger(i) && i >= 0 && i < MAX_CANDIDATES ? path.join(dir, "candidates", outfit, name, `${i}.png`) : null;

export const sheetPath = (dir: string, outfit: Outfit) => path.join(dir, "sheets", `${outfit}.png`);

export type ClipListing = { clips: Record<string, Partial<Record<ClipKind, number>>>; clipMeta: Record<string, { v: number; masks?: Manifest["masks"] }> };

/** Existing sprites as "outfit/name" → mtime (for ?v= cache busting), sheet presence per outfit, and picked clips per existing sprite (frames per kind; clipMeta.v = manifest mtime for ?v=). */
export function listSprites(dir: string): { sprites: Record<string, number>; sheets: Record<Outfit, boolean> } & ClipListing {
  const sprites: Record<string, number> = {};
  for (const o of OUTFITS) {
    for (const n of [...EXPRESSIONS, "full"]) {
      const st = fs.statSync(path.join(dir, o, `${n}.png`), { throwIfNoEntry: false });
      if (st?.isFile()) sprites[`${o}/${n}`] = Math.floor(st.mtimeMs);
    }
  }
  for (const p of POSES) for (const o of OUTFITS) for (const e of p === "back" ? [null] : EXPRESSIONS) {
    const st = fs.statSync(posePath(dir, p, o, e)!, { throwIfNoEntry: false });
    if (st?.isFile()) sprites[poseKey(p, o, e)] = Math.floor(st.mtimeMs);
  }
  for (const o of OUTFITS) for (const f of TALK_FRAMES) {
    const st = fs.statSync(talkPath(dir, o, f)!, { throwIfNoEntry: false });
    if (st?.isFile()) sprites[talkKey(o, f)] = Math.floor(st.mtimeMs);
  }
  const sheets = Object.fromEntries(OUTFITS.map((o) => [o, fs.existsSync(sheetPath(dir, o))])) as Record<Outfit, boolean>;
  return { sprites, sheets, ...listClips(dir, sprites) };
}

function listClips(dir: string, sprites: Record<string, number>): ClipListing {
  const out: ClipListing = { clips: {}, clipMeta: {} };
  let names: string[] = [];
  try { names = fs.readdirSync(path.join(dir, "clips")); } catch { return out; }
  for (const e of names) {
    const key = decodeBaseKey(e);
    const st = key && sprites[key] ? fs.statSync(manifestPath(dir, key)!, { throwIfNoEntry: false }) : null;
    if (!key || !st) continue;
    const m = readManifest(dir, key);
    out.clips[key] = Object.fromEntries(Object.entries(m.clips).map(([k, c]) => [k, c!.frames]));
    out.clipMeta[key] = { v: Math.floor(st.mtimeMs), ...(m.masks && { masks: m.masks }) };
  }
  return out;
}

/** Replace the candidate batch for one sprite (stale files removed); seeds, if given, go in meta.json. */
export function saveCandidates(dir: string, outfit: Outfit, name: Expression | "full" | TalkFrame, pngs: Buffer[], seeds?: number[], pose?: Pose, talk?: TalkFrame): void {
  const d = path.dirname((talk ? talkCandidatePath(dir, outfit, talk, 0) : pose ? poseCandidatePath(dir, pose, outfit, name === "full" ? null : name, 0) : candidatePath(dir, outfit, name as Expression, 0))!);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  pngs.slice(0, MAX_CANDIDATES).forEach((png, i) => fs.writeFileSync(path.join(d, `${i}.png`), png));
  if (seeds) fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ seeds: seeds.slice(0, MAX_CANDIDATES) }));
}

const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** The tagger's background removal, or null when it is down or returns junk. */
async function cutout(orig: Buffer, fetchFn: typeof fetch): Promise<Buffer | null> {
  try {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(orig)], { type: "image/png" }), "sprite.png");
    const r = await fetchFn(`${TAGGER_URL}/cutout`, { method: "POST", body: fd, signal: AbortSignal.timeout(120_000) });
    const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    return b && isPng(b) ? b : null;
  } catch { return null; }
}

/** Cut out the candidate's background via the tagger and save it as the sprite (+ .orig.png). Cutout down → original + note. */
export async function pick(dir: string, outfit: string, name: string, i: number, fetchFn: typeof fetch = fetch, pose?: string, talk?: string): Promise<{ ok: true; note?: string } | { error: string }> {
  const src = talk ? talkCandidatePath(dir, outfit, talk, i) : pose ? poseCandidatePath(dir, pose, outfit, name, i) : candidatePath(dir, outfit, name, i);
  const out = talk ? talkPath(dir, outfit, talk) : pose ? posePath(dir, pose, outfit, name) : spritePath(dir, outfit, name);
  if (!src || !out || !fs.existsSync(src)) return { error: "That candidate is gone — generate again." };
  const orig = fs.readFileSync(src);
  const cut = await cutout(orig, fetchFn);
  if (!cut && fs.existsSync(out)) return { error: "Background removal unavailable — kept your current sprite; try again when the tagger is warm." };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out.replace(/\.png$/, ".orig.png"), orig);
  fs.writeFileSync(out, cut ?? orig);
  return cut ? { ok: true } : { ok: true, note: "Background removal unavailable — saved the original with its background." };
}

// --- frame clips (Plan 22): NovelAI inpaint/img2img off an existing sprite ---

/** A listing key's sprite file (whitelisted), or null. */
export function baseSpritePath(dir: string, baseKey: string): string | null {
  if (!isBaseKey(baseKey)) return null;
  const p = baseKey.split("/");
  return p[0] === "pose" ? posePath(dir, p[1], p[2], p[3] ?? null) : p[0] === "talk" ? talkPath(dir, p[1], p[2]) : spritePath(dir, p[0], p[1]);
}

/** The request a sprite was drawn from, rebuilt from its key and the current look (the original isn't stored). */
export function keyRequest(baseKey: string, s: Look, seed?: number): { compiled: Compiled; params: NaiParams } | null {
  if (!isBaseKey(baseKey)) return null;
  const p = baseKey.split("/") as [string, string, string, string?];
  if (p[0] === "pose") return poseRequest(p[2] as Outfit, p[1] as Pose, (p[3] ?? null) as Expression | null, s, seed);
  if (p[0] === "talk") return talkRequest(p[1] as Outfit, p[2] as TalkFrame, s, seed);
  return p[1] === "full" ? spriteRequest(p[0] as Outfit, "full", "smug", s, seed) : spriteRequest(p[0] as Outfit, "bust", p[1] as Expression, s, seed);
}

/** Inpaint mask at w×h: white box (normalised, clamped) on black. */
export async function maskPng(w: number, h: number, m: Mask): Promise<Buffer> {
  const b = clampMask(m);
  const left = Math.round(b.x * w), top = Math.round(b.y * h);
  const bw = Math.max(1, Math.min(w - left, Math.round(b.w * w))), bh = Math.max(1, Math.min(h - top, Math.round(b.h * h)));
  const box = await sharp({ create: { width: bw, height: bh, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: "#000000" } }).composite([{ input: box, left, top }]).png().toBuffer();
}

/** The base sprite's manifest (clean), or an empty one. */
export function readManifest(dir: string, baseKey: string): Manifest {
  try { return validateManifest(JSON.parse(fs.readFileSync(manifestPath(dir, baseKey)!, "utf8"))) ?? { clips: {} }; } catch { return { clips: {} }; }
}
function writeManifest(dir: string, baseKey: string, m: Manifest): void {
  const p = manifestPath(dir, baseKey)!;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m));
}

/** Save nudged masks (only eyes/mouth, clamped) for an existing sprite. */
export function saveClipMasks(dir: string, baseKey: string, masks: unknown): Manifest {
  const m = readManifest(dir, baseKey), r = (masks ?? {}) as Record<string, unknown>;
  for (const n of ["eyes", "mouth"] as const) if (r[n] !== undefined) (m.masks ??= {})[n] = clampMask(r[n]);
  writeManifest(dir, baseKey, m);
  return m;
}

/** Candidate run i, frame n: `<dir>/candidates/clips/<baseKey~>/<kind>/<i>/<n>.png`. */
export function clipCandidatePath(dir: string, baseKey: string, kind: string, i: number, n: number): string | null {
  const e = encodeBaseKey(baseKey);
  return e && clipPath(dir, baseKey, kind, n) && Number.isInteger(i) && i >= 0 && i < MAX_CANDIDATES
    ? path.join(dir, "candidates", "clips", e, kind, String(i), `${n}.png`) : null;
}

/** One NovelAI image: compiled + params, plus img2img or infill. Returns the PNG. */
export type ClipGen = (c: Compiled, p: NaiParams, img2img?: Img2Img, infill?: Infill) => Promise<Buffer>;

const WHITE = "#ffffff", CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** n runs of one clip (each run = every frame, one seed), sequential; Stop/first error throws and nothing is replaced. Returns images drawn. */
export async function generateClip(dir: string, baseKey: string, kind: ClipKind, s: Look, n: number, gen: ClipGen, signal?: AbortSignal): Promise<{ count: number }> {
  const src = baseSpritePath(dir, baseKey), base = keyRequest(baseKey, s);
  if (!isClipKind(kind)) throw new Error("Unknown clip kind.");
  if (!src || !base || !fs.existsSync(src)) throw new Error("That sprite doesn't exist — pick one first.");
  if (!canResend(base.params)) throw new Error("That size is too large to send back to NovelAI.");
  const { width, height } = base.params, orig = src.replace(/\.png$/, ".orig.png");
  // Pre-cutout original if kept, else the cut sprite on white; at the request size (a no-op when it already matches).
  const image = (await sharp(fs.existsSync(orig) ? orig : src).resize(width, height, { fit: "contain", background: WHITE }).flatten({ background: WHITE }).png().toBuffer()).toString("base64");
  const masks = { ...defaultMasks(baseKey), ...readManifest(dir, baseKey).masks };
  const maskB64 = CLIP_SPEC[kind].mask && (await maskPng(width, height, masks[CLIP_SPEC[kind].mask!])).toString("base64");
  const runs: Buffer[][] = [], seeds: number[] = [];
  for (let i = 0; i < Math.min(MAX_CANDIDATES, Math.max(1, n)); i++) {
    const seed = newSeed(), frames: Buffer[] = [];
    seeds.push(seed);
    for (const r of clipRequests(base, kind, seed)) {
      if (signal?.aborted) throw new Error("Stopped.");
      frames.push(await gen(r.compiled, r.params, r.img2img && { image, strength: r.img2img.strength, noise: 0 }, r.infill && { image, mask: maskB64! }));
    }
    runs.push(frames);
  }
  const d = path.dirname(path.dirname(clipCandidatePath(dir, baseKey, kind, 0, 0)!));
  fs.rmSync(d, { recursive: true, force: true });
  runs.forEach((frames, i) => frames.forEach((png, f) => {
    const p = clipCandidatePath(dir, baseKey, kind, i, f)!;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, png);
  }));
  fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ seeds }));
  return { count: runs.length * CLIP_SPEC[kind].frames };
}

/** Cutout onto a transparent canvas of the base sprite's exact size at (0,0); a mismatched size is scaled to fit (shouldn't happen). */
async function alignTo(cut: Buffer, w: number, h: number): Promise<Buffer> {
  const m = await sharp(cut).metadata();
  let input = cut;
  if (m.width !== w || m.height !== h) {
    console.warn(`clip frame ${m.width}x${m.height} scaled to base ${w}x${h}`);
    input = await sharp(cut).resize(w, h, { fit: "contain", background: CLEAR }).png().toBuffer();
  }
  return sharp({ create: { width: w, height: h, channels: 4, background: CLEAR } }).composite([{ input, left: 0, top: 0 }]).png().toBuffer();
}

/** Pick candidate run i: cut out every frame (all or nothing), align to the base sprite, write frames + manifest entry. */
export async function pickClip(dir: string, baseKey: string, kind: string, i: number, fetchFn: typeof fetch = fetch): Promise<{ ok: true } | { error: string }> {
  const src = baseSpritePath(dir, baseKey);
  if (!src || !isClipKind(kind) || !fs.existsSync(src)) return { error: "Unknown sprite or clip." };
  const spec = CLIP_SPEC[kind], { width = 0, height = 0 } = await sharp(src).metadata();
  const frames: Buffer[] = [];
  for (let n = 0; n < spec.frames; n++) {
    const c = clipCandidatePath(dir, baseKey, kind, i, n);
    if (!c || !fs.existsSync(c)) return { error: "That candidate is gone — generate again." };
    const cut = await cutout(fs.readFileSync(c), fetchFn);
    if (!cut) return { error: "Background removal unavailable — nothing changed; try again when the tagger is warm." };
    frames.push(await alignTo(cut, width, height));
  }
  frames.forEach((png, n) => {
    const p = clipPath(dir, baseKey, kind, n)!;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, png);
  });
  const m = readManifest(dir, baseKey);
  m.clips[kind] = { frames: spec.frames, fps: spec.fps, loop: spec.loop };
  writeManifest(dir, baseKey, m);
  return { ok: true };
}

/** Images a clip run draws for these kinds (n runs each). */
export const clipCount = (kinds: readonly ClipKind[], n: number): number => kinds.reduce((t, k) => t + CLIP_SPEC[k].frames * n, 0);
