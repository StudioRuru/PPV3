import { NextRequest, NextResponse } from "next/server";
import { tagIndex } from "@/lib/tag-index";
import { suggest } from "@/lib/tags";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return NextResponse.json({ items: suggest(tagIndex(), req.nextUrl.searchParams.get("q") ?? "") });
}

let known: Set<string> | null = null;

export async function POST(req: NextRequest) {
  const { tags } = await req.json().catch(() => ({}));
  const set = (known ??= new Set(tagIndex().flatMap((t) => [t.name.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())])));
  const list: string[] = Array.isArray(tags) ? tags.filter((t) => typeof t === "string").slice(0, 200) : [];
  return NextResponse.json({ unknown: list.filter((t) => !set.has(t.toLowerCase().replace(/^artist:/, "").replace(/_/g, " "))) });
}
