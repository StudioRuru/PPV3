import { NextRequest, NextResponse } from "next/server";
import { tagIndex } from "@/lib/tag-index";
import { suggest } from "@/lib/tags";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return NextResponse.json({ items: suggest(tagIndex(), req.nextUrl.searchParams.get("q") ?? "") });
}
