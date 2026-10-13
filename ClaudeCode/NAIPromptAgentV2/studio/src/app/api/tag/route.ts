import { NextRequest, NextResponse } from "next/server";
import { TAGGER_URL } from "@/lib/env";
import { readRecipe, recipeToState } from "@/lib/recipe";
import { yamlGroups } from "@/lib/tag-index";
import { yamlGroupRank } from "@/lib/tags";
import type { RawTag } from "@/lib/tagger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });

  const fd = new FormData();
  fd.append("file", file, "upload");
  let res: Response;
  try {
    res = await fetch(`${TAGGER_URL}/tag`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
  } catch {
    return NextResponse.json({ error: "Tagger offline — run `npm run tagger` on the Mac." }, { status: 503 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: data.detail ?? `Tagger error ${res.status}` }, { status: res.status === 422 ? 422 : 502 });

  const groups = yamlGroups();
  const tags: RawTag[] = data.tags.map((t: RawTag) => (t.category === "general" ? { ...t, group: yamlGroupRank(t.name, groups) } : t));
  const recipe = await readRecipe(Buffer.from(await file.arrayBuffer())).catch(() => null);
  return NextResponse.json({ tags, thresholds: data.thresholds, ms: data.ms, recipe: recipe ? { recipe, ...recipeToState(recipe) } : null });
}
