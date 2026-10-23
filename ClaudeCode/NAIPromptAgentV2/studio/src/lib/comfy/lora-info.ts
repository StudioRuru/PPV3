import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { CIVITAI_TOKEN } from "../env";
import { LORA_DIR } from "./loras";
import { fits, type Family, type LoraInfo } from "./recipe";

export { fits };
export type { Family, LoraInfo };
type Db = Database.Database;
const UNKNOWN: LoraInfo = { family: null, words: [], weight: null };

/** Civitai / kohya base-model string to a studio family; anything else (Wan, Flux, ...) is unknown. */
export function familyOf(base: string): Family | null {
  const s = base.toLowerCase();
  if (/krea/.test(s)) return "krea2";
  if (/moss/.test(s)) return "moss";
  if (/qwen/.test(s)) return "qwen";
  return /sdxl|stable-diffusion-xl|pony|illustrious|noobai/.test(s) ? "sdxl" : null;
}

const clean = (w: unknown) => (typeof w === "string" ? w.trim().replace(/^,+|,+$/g, "").trim() : "");

/** Kohya headers: base model plus tag frequencies. Words = top 3 tags (longer than 1 char) with at least a quarter of the top count. */
export function fromHeader(meta: Record<string, string>): LoraInfo {
  const counts = new Map<string, number>();
  try {
    for (const ds of Object.values(JSON.parse(meta.ss_tag_frequency ?? "{}") as Record<string, Record<string, number>>))
      for (const [t, n] of Object.entries(ds)) if (t.trim().length > 1) counts.set(t.trim(), (counts.get(t.trim()) ?? 0) + n);
  } catch { /* unreadable tag frequency: no words */ }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { family: familyOf(meta.ss_base_model_version || meta["modelspec.architecture"] || ""), words: top.filter(([, n]) => n >= top[0][1] / 4).map(([t]) => t), weight: null };
}

export function fromCivitai(json: unknown): LoraInfo {
  const j = (json ?? {}) as { baseModel?: unknown; trainedWords?: unknown };
  const words = Array.isArray(j.trainedWords) ? j.trainedWords.map(clean).filter(Boolean) : [];
  return { family: typeof j.baseModel === "string" ? familyOf(j.baseModel) : null, words, weight: null };
}


async function headerMeta(file: string): Promise<Record<string, string> | null> {
  try {
    const fd = await fsp.open(file);
    try {
      const head = Buffer.alloc(8);
      if ((await fd.read(head, 0, 8, 0)).bytesRead !== 8) return null;
      const n = Number(head.readBigUInt64LE(0));
      if (n < 2 || n > 100_000_000) return null;
      const buf = Buffer.alloc(n);
      if ((await fd.read(buf, 0, n, 8)).bytesRead !== n) return null;
      return (JSON.parse(buf.toString("utf8")) as { __metadata__?: Record<string, string> }).__metadata__ ?? {};
    } finally { await fd.close(); }
  } catch { return null; }
}

const sha256 = (file: string) => new Promise<string>((res, rej) => {
  const h = crypto.createHash("sha256");
  fs.createReadStream(file).on("data", (c) => h.update(c)).on("error", rej).on("end", () => res(h.digest("hex")));
});

export async function resolveInfo(names: string[], deps: { db: Db; manifestSha: Map<string, string>; dir?: string; fetch?: typeof fetch }): Promise<Record<string, LoraInfo>> {
  const { db, manifestSha, dir = LORA_DIR, fetch: doFetch = fetch } = deps;
  const out: Record<string, LoraInfo> = {};
  for (const name of names) { // one after another: civitai gets polite sequential lookups
    const row = db.prepare("SELECT info, sha FROM comfy_lora_info WHERE name = ?").get(name) as { info: string | null; sha: string | null } | undefined;
    if (row?.info) { try { out[name] = JSON.parse(row.info) as LoraInfo; continue; } catch { /* bad row: recompute */ } }
    const file = path.join(dir, name);
    const local = fs.existsSync(file);
    const meta = local ? await headerMeta(file) : null;
    let info = meta ? fromHeader(meta) : { ...UNKNOWN };
    let settled = !!info.family && info.words.length > 0; // nothing left to ask civitai
    if (!settled) {
      try {
        let sha = manifestSha.get(name) ?? row?.sha ?? null;
        if (!sha && local) {
          sha = await sha256(file); // multi-GB read: keep it so a retry after a network error skips it
          db.prepare("INSERT OR REPLACE INTO comfy_lora_info (name, info, sha) VALUES (?,NULL,?)").run(name, sha);
        }
        if (sha) {
          const r = await doFetch(`https://civitai.red/api/v1/model-versions/by-hash/${sha}`, { headers: { Authorization: `Bearer ${CIVITAI_TOKEN}` }, signal: AbortSignal.timeout(5000) });
          if (r.ok) { const c = fromCivitai(await r.json()); info = { family: info.family ?? c.family, words: info.words.length ? info.words : c.words, weight: info.weight ?? c.weight }; settled = true; }
          else if (r.status === 404) settled = true; // civitai definitively doesn't know it
        }
      } catch { /* offline or timed out: answer from the header, cache nothing */ }
    }
    if (settled) db.prepare("INSERT OR REPLACE INTO comfy_lora_info (name, info, sha) VALUES (?,?,?)").run(name, JSON.stringify(info), row?.sha ?? null);
    out[name] = info;
  }
  return out;
}
