import { NextResponse } from "next/server";
import { COMFY_TS_AUTHKEY, DANBOORU_API_KEY, DANBOORU_LOGIN, HYPERSTACK_API_KEY, HYPERSTACK_KEY_NAME } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Which optional server features are configured — booleans only, never the values. */
export function GET() {
  return NextResponse.json({ danbooru: !!(DANBOORU_LOGIN && DANBOORU_API_KEY), comfy: !!(HYPERSTACK_API_KEY && HYPERSTACK_KEY_NAME && COMFY_TS_AUTHKEY) });
}
