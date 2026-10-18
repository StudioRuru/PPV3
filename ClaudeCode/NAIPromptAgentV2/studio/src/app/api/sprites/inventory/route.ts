import { NextRequest, NextResponse } from "next/server";
import { COMFY_DIR, SPRITE_LIB } from "@/lib/env";
import { removeKeyData } from "@/lib/sprites/library";
import { type SpriteKey, type Tier, addOutfit, listKeys, setEdge, spritesDb, upsertKey } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const slug = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9_]{1,40}$/.test(s);
const TIERS = ["tame", "teasing", "lewd"];

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return bad("Bad JSON");
  const db = spritesDb();
  const surface = b.surface === "chat" || b.surface === "stage" ? b.surface : null;
  switch (b.op) {
    case "add-key": case "update-key": {
      if (!surface || !slug(b.key)) return bad("Need a surface and a key (a-z, 0-9, _).");
      if (typeof b.label !== "string" || !b.label.trim() || typeof b.prompt !== "string") return bad("Need a label and a prompt.");
      if (!TIERS.includes(b.tier as string)) return bad("Bad tier.");
      const old = listKeys(db, surface);
      const prev = old.find((k) => k.key === b.key);
      if (b.op === "add-key" ? prev : !prev) return bad(b.op === "add-key" ? "That key already exists." : "No such key.", prev ? 400 : 404);
      const tags = Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === "string") : [];
      const k: SpriteKey = { surface, key: b.key, label: b.label.trim(), tier: b.tier as Tier, tags, prompt: b.prompt, sort: prev?.sort ?? old.reduce((m, x) => Math.max(m, x.sort), -1) + 1 };
      upsertKey(db, k);
      return NextResponse.json({ ok: true });
    }
    case "remove-key":
      if (!surface || typeof b.key !== "string") return bad("Need a surface and a key.");
      removeKeyData(db, surface, b.key, { dir: COMFY_DIR, lib: SPRITE_LIB });
      return NextResponse.json({ ok: true });
    case "add-outfit":
      if (!slug(b.key) || typeof b.label !== "string" || !b.label.trim()) return bad("Need an outfit key (a-z, 0-9, _) and a label.");
      addOutfit(db, b.key, b.label.trim());
      return NextResponse.json({ ok: true });
    case "edge":
      if (typeof b.a !== "string" || typeof b.b !== "string" || b.a === b.b) return bad("Need two different keys.");
      setEdge(db, b.a, b.b, b.on !== false);
      return NextResponse.json({ ok: true });
    default:
      return bad("Unknown op.");
  }
}
