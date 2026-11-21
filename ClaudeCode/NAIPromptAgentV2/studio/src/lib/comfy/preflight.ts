import type Database from "better-sqlite3";
import { type Card, getJson, putJson } from "./store";
import type { ManifestEntry } from "./pod";
import { HF_TOKEN, CIVITAI_TOKEN } from "../env";

type Db = Database.Database;
export type Dead = { label: string; filename: string; url: string; status: number };
type VolFile = { name: string; size: number };
const DAY = 24 * 3600_000;
const KIND_WORD: Record<string, string> = { diffusion_models: "checkpoint", loras: "LoRA", text_encoders: "text encoder", vae: "VAE" };

/** Records what the models volume really holds, so preflight skips files already there. Clears the good-link cache. */
export function saveVolumeList(db: Db, card: Card, files: VolFile[]): void {
  putJson(db, "volume." + card, files);
  putJson(db, "preflight." + card, null);
}

export async function preflight(card: Card, deps: { db: Db; manifest: ManifestEntry[]; head: (url: string) => Promise<number>; now: number }): Promise<Dead[]> {
  const { db, manifest, head, now } = deps;
  const last = getJson<number>(db, "preflight." + card);
  if (typeof last === "number" && now - last < DAY) return [];
  const have = new Set((getJson<VolFile[]>(db, "volume." + card) ?? []).map((f) => `${f.name}:${f.size}`));
  const dead: Dead[] = [];
  for (const m of manifest.filter((x) => x.cards.includes(card) && !have.has(`${x.kind}/${x.filename}:${x.size}`))) {
    const codes = await Promise.all(m.urls.map(head));
    if (codes.every((c) => c >= 400)) {
      dead.push({ label: `${m.filename.replace(/\.[^.]+$/, "")} ${KIND_WORD[m.kind] ?? m.kind}`, filename: m.filename, url: m.urls[0], status: codes[0] });
    }
  }
  if (!dead.length) putJson(db, "preflight." + card, now);
  return dead;
}

export async function headUrl(url: string): Promise<number> {
  try {
    const host = new URL(url).hostname;
    const headers: Record<string, string> = {};
    if (/(^|\.)huggingface\.co$/.test(host) && HF_TOKEN) headers.Authorization = `Bearer ${HF_TOKEN}`;
    else if (/(^|\.)civitai\.[a-z]+$/.test(host) && CIVITAI_TOKEN) headers.Authorization = `Bearer ${CIVITAI_TOKEN}`;
    return (await fetch(url, { method: "HEAD", redirect: "follow", headers, signal: AbortSignal.timeout(15_000) })).status;
  } catch { return 599; }
}

export const deadMessage = (d: Dead[]): string =>
  d.map((x) => `${x.label} link is dead — fix the manifest (${x.filename}, ${x.status})`).join("; ");
