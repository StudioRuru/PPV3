import { NextResponse } from "next/server";
import { DANBOORU_API_KEY, DANBOORU_LOGIN } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Which optional server features are configured — booleans only, never the values. */
export function GET() {
  return NextResponse.json({ danbooru: !!(DANBOORU_LOGIN && DANBOORU_API_KEY) });
}
