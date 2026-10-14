import { NextRequest, NextResponse } from "next/server";
import { DANBOORU_API_KEY, DANBOORU_LOGIN } from "@/lib/env";
import type { Rating } from "@/lib/prompt";
import { danbooruQuery, danbooruTags, type DanbooruPost } from "@/lib/recreate";
import { yamlGroups } from "@/lib/tag-index";
import { yamlGroupRank } from "@/lib/tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Post = DanbooruPost & { id: number; rating: string; preview_file_url?: string; large_file_url?: string; image_width: number; image_height: number };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rating = (["safe", "nsfw", "off"].includes(sp.get("rating") ?? "") ? sp.get("rating") : "off") as Rating;
  const page = Math.min(50, Math.max(1, Math.floor(Number(sp.get("page")) || 1)));
  const url = new URL("https://danbooru.donmai.us/posts.json");
  url.searchParams.set("tags", danbooruQuery(sp.get("q") ?? "", rating));
  url.searchParams.set("limit", "24");
  url.searchParams.set("page", String(page));
  if (DANBOORU_LOGIN && DANBOORU_API_KEY) { url.searchParams.set("login", DANBOORU_LOGIN); url.searchParams.set("api_key", DANBOORU_API_KEY); }

  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "NAIStudio/0.1 (personal use)" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return NextResponse.json({ error: "Danbooru unreachable — check the Mac's connection." }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) {
    return NextResponse.json({ error: data?.message ?? `Danbooru error ${res.status}.` }, { status: res.status === 422 ? 422 : 502 });
  }
  const groups = yamlGroups();
  const posts = (data as Post[]).filter((p) => p.preview_file_url).map((p) => ({
    id: p.id, rating: p.rating, preview: p.preview_file_url, large: p.large_file_url ?? p.preview_file_url,
    w: p.image_width, h: p.image_height,
    character: p.tag_string_character, copyright: p.tag_string_copyright, artist: p.tag_string_artist,
    tags: danbooruTags(p, (n) => yamlGroupRank(n, groups)),
  }));
  // Danbooru page size is 24; banned posts (no preview) are filtered, so "more" comes from the raw count.
  return NextResponse.json({ posts, more: data.length === 24 });
}
